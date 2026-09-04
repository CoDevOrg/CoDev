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
  CURSOR_COOKIE_MAX_AGE_SECONDS,
  exchangeCursorApiKey,
  exchangeOAuthCode,
  getOAuthConfiguration,
  getOAuthFlowMode,
  oauthCallbackPath,
  oauthCookieName,
  OAuthConfigurationError,
  openOAuthState,
  parseManualAuthorizationCode,
  persistCursorTokens,
  persistOAuthTokens,
  pollCodexDeviceCode,
  pollCursorLogin,
  requestCodexDeviceCode,
  sealOAuthState,
  startCursorLogin,
  type OAuthProvider,
  type OAuthState,
} from "./oauth";

const scopeTypeSchema = z.enum(["USER", "WORKSPACE"]);
const DEFAULT_OAUTH_RETURN_TO = "/settings/personal/providers";

const sessionBodySchema = z.object({
  scopeType: z.enum(["USER", "WORKSPACE"]).optional(),
  workspaceId: z.string().uuid().optional(),
  returnTo: z.string().optional(),
  code: z.string().optional(),
  deviceAuthId: z.string().optional(),
  userCode: z.string().optional(),
  apiKey: z.string().optional(),
});

function safeReturnTo(
  value: string | null | undefined,
  fallback = DEFAULT_OAUTH_RETURN_TO,
) {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : fallback;
}

function redirectToSettings(
  request: Request,
  provider: OAuthProvider,
  status: "connected" | "denied" | "error" | "not_configured",
  returnTo = DEFAULT_OAUTH_RETURN_TO,
) {
  const url = new URL(safeReturnTo(returnTo), request.url);
  url.searchParams.set("oauth", provider);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url);
}

function setOAuthCookie(
  response: NextResponse,
  provider: OAuthProvider,
  state: OAuthState,
) {
  response.cookies.set({
    name: oauthCookieName(provider),
    value: sealOAuthState(state),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:
      provider === "cursor"
        ? CURSOR_COOKIE_MAX_AGE_SECONDS
        : COOKIE_MAX_AGE_SECONDS,
    path: `/api/auth/oauth/${provider}`,
  });
  return response;
}

function clearOAuthCookie(response: NextResponse, provider: OAuthProvider) {
  response.cookies.set({
    name: oauthCookieName(provider),
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: `/api/auth/oauth/${provider}`,
  });
  return response;
}

async function authorizeScope(input: {
  request: Request;
  provider: OAuthProvider;
  scopeType: "USER" | "WORKSPACE";
  scopeId: string;
  returnTo: string;
  asJson: boolean;
}) {
  const { request, provider, scopeType, scopeId, returnTo, asJson } = input;
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

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
      returnTo,
    });

    if (configuration.flowMode === "cursor_deeplink") {
      const login = startCursorLogin(new URL(request.url).origin);
      return setOAuthCookie(
        NextResponse.json({
          mode: configuration.flowMode,
          provider,
          loginUrl: login.loginUrl,
          intervalSeconds: 2,
        }),
        provider,
        { ...state, cursorUuid: login.uuid, cursorVerifier: login.verifier },
      );
    }

    if (configuration.flowMode === "device_code") {
      const device = await requestCodexDeviceCode(configuration.clientId);
      return setOAuthCookie(
        NextResponse.json({
          mode: configuration.flowMode,
          provider,
          verificationUrl: device.verificationUrl,
          userCode: device.userCode,
          deviceAuthId: device.deviceAuthId,
          intervalSeconds: device.intervalSeconds,
        }),
        provider,
        state,
      );
    }

    if (configuration.flowMode === "manual_code") {
      const authorizeUrl = buildAuthorizationUrl(
        configuration,
        state,
      ).toString();
      if (asJson) {
        return setOAuthCookie(
          NextResponse.json({
            mode: configuration.flowMode,
            provider,
            authorizeUrl,
          }),
          provider,
          state,
        );
      }
      return setOAuthCookie(
        NextResponse.redirect(authorizeUrl),
        provider,
        state,
      );
    }

    const authorizeUrl = buildAuthorizationUrl(configuration, state);
    if (asJson) {
      return setOAuthCookie(
        NextResponse.json({
          mode: configuration.flowMode,
          provider,
          authorizeUrl: authorizeUrl.toString(),
        }),
        provider,
        state,
      );
    }
    return setOAuthCookie(NextResponse.redirect(authorizeUrl), provider, state);
  } catch (error) {
    if (asJson) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "OAuth could not be started.",
        },
        { status: error instanceof OAuthConfigurationError ? 503 : 502 },
      );
    }
    return redirectToSettings(request, provider, "not_configured", returnTo);
  }
}

async function parseSessionInput(request: Request) {
  const url = new URL(request.url);
  let scopeTypeRaw = url.searchParams.get("scopeType");
  let workspaceId = url.searchParams.get("workspaceId");
  let returnTo = url.searchParams.get("returnTo");

  if (request.method !== "GET") {
    try {
      const parsed = sessionBodySchema.safeParse(await request.json());
      if (parsed.success) {
        if (parsed.data.scopeType) scopeTypeRaw = parsed.data.scopeType;
        if (parsed.data.workspaceId) workspaceId = parsed.data.workspaceId;
        if (parsed.data.returnTo) returnTo = parsed.data.returnTo;
      }
    } catch {
      // Query-string session starts remain valid.
    }
  }

  const scopeTypeResult = scopeTypeSchema.safeParse(
    (scopeTypeRaw ?? "USER").toUpperCase(),
  );
  if (!scopeTypeResult.success) {
    return {
      error: NextResponse.json(
        { error: "scopeType must be USER or WORKSPACE." },
        { status: 400 },
      ),
    } as const;
  }

  const scopeType = scopeTypeResult.data;
  if (scopeType === "WORKSPACE" && !z.uuid().safeParse(workspaceId).success) {
    return {
      error: NextResponse.json(
        { error: "workspaceId is required for workspace OAuth." },
        { status: 400 },
      ),
    } as const;
  }

  const user = await getApiUser();
  return {
    scopeType,
    scopeId: scopeType === "WORKSPACE" ? workspaceId! : (user?.id ?? ""),
    returnTo: safeReturnTo(returnTo),
  } as const;
}

export async function startOAuth(request: Request, provider: OAuthProvider) {
  const resolved = await parseSessionInput(request);
  if ("error" in resolved) return resolved.error;

  const flowMode = getOAuthFlowMode(provider);
  if (request.method === "GET" && flowMode !== "app_callback") {
    // Hosted Claude/Codex flows need the interactive settings UI.
    return redirectToSettings(request, provider, "error", resolved.returnTo);
  }

  return authorizeScope({
    request,
    provider,
    scopeType: resolved.scopeType,
    scopeId: resolved.scopeId,
    returnTo: resolved.returnTo,
    asJson: false,
  });
}

export async function startOAuthSession(
  request: Request,
  provider: OAuthProvider,
) {
  const resolved = await parseSessionInput(request);
  if ("error" in resolved) return resolved.error;

  return authorizeScope({
    request,
    provider,
    scopeType: resolved.scopeType,
    scopeId: resolved.scopeId,
    returnTo: resolved.returnTo,
    asJson: true,
  });
}

async function readOAuthState(
  provider: OAuthProvider,
): Promise<OAuthState | null> {
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(oauthCookieName(provider))?.value;
  if (!stateCookie) return null;
  try {
    return openOAuthState(stateCookie);
  } catch {
    return null;
  }
}

export async function completeManualOAuth(
  request: Request,
  provider: OAuthProvider,
) {
  if (provider !== "claude") {
    return NextResponse.json(
      { error: "Manual code completion is only supported for Claude Code." },
      { status: 400 },
    );
  }

  const state = await readOAuthState(provider);
  if (!state) {
    return NextResponse.json(
      { error: "OAuth session expired. Start the connection again." },
      { status: 400 },
    );
  }

  const parsed = sessionBodySchema.safeParse(
    await request.json().catch(() => ({})),
  );
  const codeRaw = parsed.success ? (parsed.data.code ?? "") : "";
  if (!codeRaw.trim()) {
    return NextResponse.json(
      { error: "Authorization code is required." },
      { status: 400 },
    );
  }

  try {
    const { code, returnedState } = parseManualAuthorizationCode(codeRaw);
    if (returnedState && returnedState !== state.state) {
      throw new Error("OAuth state mismatch.");
    }
    const user = await getApiUser();
    if (!user || user.id !== state.userId) {
      throw new Error("OAuth user mismatch.");
    }
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
      state.state,
    );
    await persistOAuthTokens(state, configuration, tokens);
    return clearOAuthCookie(
      NextResponse.json({ status: "connected", provider }),
      provider,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "OAuth completion failed.",
      },
      { status: 400 },
    );
  }
}

/**
 * Cursor's `/complete`: takes a Cursor **user API key**, exchanges it for the
 * same `{ accessToken, refreshToken }` pair as the browser login, and stores it
 * as a `cursor` OAUTH_TOKEN connection. Needs no in-flight OAuth session — the
 * key is the credential — so it works even after the deeplink poll has expired.
 */
export async function completeCursorApiKey(request: Request) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const parsed = sessionBodySchema.safeParse(
    await request.json().catch(() => ({})),
  );
  const apiKey = parsed.success ? (parsed.data.apiKey ?? "").trim() : "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "A Cursor API key is required." },
      { status: 400 },
    );
  }

  const scopeType =
    parsed.success && parsed.data.scopeType === "WORKSPACE"
      ? "WORKSPACE"
      : "USER";
  const workspaceId = parsed.success ? parsed.data.workspaceId : undefined;
  if (scopeType === "WORKSPACE" && !workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required for a workspace credential." },
      { status: 400 },
    );
  }
  const scopeId = scopeType === "WORKSPACE" ? workspaceId! : user.id;

  try {
    if (scopeType === "WORKSPACE") {
      await requireOrganizationSettingsWrite(user.id, scopeId);
    }
    const tokens = await exchangeCursorApiKey(apiKey);
    await persistCursorTokens({ scopeType, scopeId }, tokens);
    return NextResponse.json({ status: "connected", provider: "cursor" });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Cursor API key connection failed.",
      },
      { status: 400 },
    );
  }
}

export async function pollDeviceOAuth(
  request: Request,
  provider: OAuthProvider,
) {
  if (provider !== "codex" && provider !== "cursor") {
    return NextResponse.json(
      { error: "Polled completion is only supported for Codex and Cursor." },
      { status: 400 },
    );
  }

  const state = await readOAuthState(provider);
  if (!state) {
    return NextResponse.json(
      { error: "OAuth session expired. Start the connection again." },
      { status: 400 },
    );
  }

  try {
    const user = await getApiUser();
    if (!user || user.id !== state.userId) {
      throw new Error("OAuth user mismatch.");
    }
    if (state.scopeType === "WORKSPACE") {
      await requireOrganizationSettingsWrite(user.id, state.scopeId);
    }

    if (provider === "cursor") {
      if (!state.cursorUuid || !state.cursorVerifier) {
        throw new Error("Cursor login session is incomplete.");
      }
      const poll = await pollCursorLogin({
        uuid: state.cursorUuid,
        verifier: state.cursorVerifier,
      });
      if (poll.status === "pending") {
        return NextResponse.json({ status: "pending" });
      }
      if (poll.status === "denied") {
        return clearOAuthCookie(
          NextResponse.json({ status: "denied", provider }),
          provider,
        );
      }
      await persistCursorTokens(
        { scopeType: state.scopeType, scopeId: state.scopeId },
        { accessToken: poll.accessToken, refreshToken: poll.refreshToken },
      );
      return clearOAuthCookie(
        NextResponse.json({ status: "connected", provider }),
        provider,
      );
    }

    const parsed = sessionBodySchema.safeParse(
      await request.json().catch(() => ({})),
    );
    const deviceAuthId = parsed.success ? (parsed.data.deviceAuthId ?? "") : "";
    const userCode = parsed.success ? (parsed.data.userCode ?? "") : "";
    if (!deviceAuthId || !userCode) {
      return NextResponse.json(
        { error: "Device authorization details are required." },
        { status: 400 },
      );
    }

    const poll = await pollCodexDeviceCode({ deviceAuthId, userCode });
    if (poll.status === "pending") {
      return NextResponse.json({ status: "pending" });
    }

    const configuration = getOAuthConfiguration(
      provider,
      new URL(request.url).origin,
    );
    const tokens = await exchangeOAuthCode(
      configuration,
      poll.authorizationCode,
      poll.codeVerifier,
    );
    await persistOAuthTokens(state, configuration, tokens);
    return clearOAuthCookie(
      NextResponse.json({ status: "connected", provider }),
      provider,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Device authorization failed.",
      },
      { status: 400 },
    );
  }
}

export async function finishOAuth(request: Request, provider: OAuthProvider) {
  const cookieStore = await cookies();
  const cookieName = oauthCookieName(provider);
  const stateCookie = cookieStore.get(cookieName)?.value;
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
    return clearOAuthCookie(
      redirectToSettings(request, provider, "denied", returnTo),
      provider,
    );
  }

  const code = query.get("code");
  const returnedState = query.get("state");
  if (!code || !returnedState) {
    return clearOAuthCookie(
      redirectToSettings(request, provider, "error", returnTo),
      provider,
    );
  }

  try {
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
      state.state,
    );
    await persistOAuthTokens(state, configuration, tokens);
    return clearOAuthCookie(
      redirectToSettings(request, provider, "connected", returnTo),
      provider,
    );
  } catch (error) {
    return clearOAuthCookie(
      redirectToSettings(
        request,
        provider,
        error instanceof OAuthConfigurationError ? "not_configured" : "error",
        returnTo,
      ),
      provider,
    );
  }
}

export { oauthCallbackPath };
