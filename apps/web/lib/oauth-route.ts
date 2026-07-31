import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiUser } from "./api";
import { requireOrganizationSettingsWrite } from "./settings-access";
import {
  buildAuthorizationUrl,
  COOKIE_MAX_AGE_SECONDS,
  createOAuthState,
  exchangeOAuthCode,
  getOAuthConfiguration,
  oauthCallbackPath,
  oauthCookieName,
  openOAuthState,
  persistOAuthTokens,
  sealOAuthState,
  type OAuthProvider,
  type OAuthState,
} from "./oauth";

const scopeTypeSchema = z.enum(["USER", "WORKSPACE"]);
const DEFAULT_OAUTH_RETURN_TO = "/settings/personal/agents";

function safeReturnTo(
  value: string | null,
  fallback = DEFAULT_OAUTH_RETURN_TO,
) {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : fallback;
}

function redirectToSettings(
  request: Request,
  provider: OAuthProvider,
  status: "connected" | "denied" | "error",
  returnTo = DEFAULT_OAUTH_RETURN_TO,
) {
  const url = new URL(safeReturnTo(returnTo), request.url);
  url.searchParams.set("oauth", provider);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url);
}

async function authorizeScope(
  request: Request,
  provider: OAuthProvider,
  scopeType: "USER" | "WORKSPACE",
  scopeId: string,
) {
  const user = await getApiUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );

  if (scopeType === "WORKSPACE") {
    try {
      await requireOrganizationSettingsWrite(user.id, scopeId);
    } catch {
      return NextResponse.json(
        { error: "Workspace credential access denied." },
        { status: 403 },
      );
    }
  }

  try {
    const configuration = getOAuthConfiguration(
      provider,
      new URL(request.url).origin,
    );
    const state = createOAuthState({
      userId: user.id,
      scopeType,
      scopeId,
      returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")),
    });
    const response = NextResponse.redirect(
      buildAuthorizationUrl(configuration, state),
    );
    response.cookies.set({
      name: oauthCookieName(provider),
      value: sealOAuthState(state),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE_SECONDS,
      path: `/api/auth/oauth/${provider}`,
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: "OAuth is not configured for this provider." },
      { status: 503 },
    );
  }
}

export async function startOAuth(request: Request, provider: OAuthProvider) {
  const url = new URL(request.url);
  const scopeTypeResult = scopeTypeSchema.safeParse(
    (url.searchParams.get("scopeType") ?? "USER").toUpperCase(),
  );
  if (!scopeTypeResult.success) {
    return NextResponse.json(
      { error: "scopeType must be USER or WORKSPACE." },
      { status: 400 },
    );
  }
  const scopeType = scopeTypeResult.data;
  const workspaceId = url.searchParams.get("workspaceId");
  if (scopeType === "WORKSPACE" && !z.uuid().safeParse(workspaceId).success) {
    return NextResponse.json(
      { error: "workspaceId is required for workspace OAuth." },
      { status: 400 },
    );
  }
  return authorizeScope(
    request,
    provider,
    scopeType,
    scopeType === "WORKSPACE" ? workspaceId! : ((await getApiUser())?.id ?? ""),
  );
}

export async function finishOAuth(request: Request, provider: OAuthProvider) {
  const cookieStore = await cookies();
  const cookieName = oauthCookieName(provider);
  const stateCookie = cookieStore.get(cookieName)?.value;
  const clearCookie = (response: NextResponse) => {
    response.cookies.set({
      name: cookieName,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: `/api/auth/oauth/${provider}`,
    });
    return response;
  };

  if (!stateCookie) return redirectToSettings(request, provider, "error");
  let state: OAuthState | null = null;
  try {
    state = openOAuthState(stateCookie);
  } catch {
    return redirectToSettings(request, provider, "error");
  }
  const returnTo = state.returnTo;
  const query = new URL(request.url).searchParams;
  if (query.get("error")) {
    return clearCookie(
      redirectToSettings(request, provider, "denied", returnTo),
    );
  }

  const code = query.get("code");
  const returnedState = query.get("state");
  if (!code || !returnedState) {
    return clearCookie(
      redirectToSettings(request, provider, "error", returnTo),
    );
  }

  try {
    if (!state) throw new Error("OAuth state is missing.");
    if (state.state !== returnedState) throw new Error("OAuth state mismatch.");
    const user = await getApiUser();
    if (!user || user.id !== state.userId)
      throw new Error("OAuth user mismatch.");
    if (state.scopeType === "WORKSPACE") {
      await requireOrganizationSettingsWrite(user.id, state.scopeId);
    }
    const configuration = getOAuthConfiguration(
      provider,
      new URL(request.url).origin,
    );
    const tokens = await exchangeOAuthCode(
      configuration,
      code,
      state.codeVerifier,
    );
    await persistOAuthTokens(state, configuration, tokens);
    return clearCookie(
      redirectToSettings(request, provider, "connected", returnTo),
    );
  } catch {
    // Never place provider error bodies, authorization codes, or tokens in the
    // redirect or response body.
    return clearCookie(
      redirectToSettings(request, provider, "error", returnTo),
    );
  }
}

export { oauthCallbackPath };
