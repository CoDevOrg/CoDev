import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspacePermission } from "./access";
import { getApiUser } from "./api";
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
} from "./oauth";

const scopeTypeSchema = z.enum(["USER", "WORKSPACE"]);

function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/settings";
}

function redirectToSettings(
  request: Request,
  provider: OAuthProvider,
  status: "connected" | "denied" | "error",
) {
  const url = new URL("/settings", request.url);
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
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  if (scopeType === "WORKSPACE") {
    try {
      await requireWorkspacePermission(scopeId, user.id, "invite");
    } catch {
      return NextResponse.json({ error: "Workspace credential access denied." }, { status: 403 });
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
  const scopeType = scopeTypeSchema.parse(
    (url.searchParams.get("scopeType") ?? "USER").toUpperCase(),
  );
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
    scopeType === "WORKSPACE" ? workspaceId! : (await getApiUser())?.id ?? "",
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
  const query = new URL(request.url).searchParams;
  if (query.get("error")) {
    return clearCookie(redirectToSettings(request, provider, "denied"));
  }

  const code = query.get("code");
  const returnedState = query.get("state");
  if (!code || !returnedState) {
    return clearCookie(redirectToSettings(request, provider, "error"));
  }

  try {
    const state = openOAuthState(stateCookie);
    if (state.state !== returnedState) throw new Error("OAuth state mismatch.");
    const user = await getApiUser();
    if (!user || user.id !== state.userId) throw new Error("OAuth user mismatch.");
    if (state.scopeType === "WORKSPACE") {
      await requireWorkspacePermission(state.scopeId, user.id, "invite");
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
    return clearCookie(redirectToSettings(request, provider, "connected"));
  } catch {
    // Never place provider error bodies, authorization codes, or tokens in the
    // redirect or response body.
    return clearCookie(redirectToSettings(request, provider, "error"));
  }
}

export { oauthCallbackPath };
