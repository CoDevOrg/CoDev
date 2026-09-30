import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiUser } from "../http/api";
import { persistCodexSubscriptionFromOAuth } from "./codex-oauth-connection";
import {
  buildAuthorizationUrl,
  COOKIE_MAX_AGE_SECONDS,
  createOAuthState,
  exchangeOAuthCode,
  getOAuthConfiguration,
  oauthCallbackPath,
  oauthCookieName,
  OAuthConfigurationError,
  openOAuthState,
  pollCodexDeviceCode,
  requestCodexDeviceCode,
  sealOAuthState,
  type OAuthProvider,
  type OAuthState,
} from "./oauth";

const DEFAULT_OAUTH_RETURN_TO = "/settings/personal/providers";

const sessionBodySchema = z.object({
  returnTo: z.string().optional(),
  code: z.string().optional(),
  deviceAuthId: z.string().optional(),
  userCode: z.string().optional(),
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
    maxAge: COOKIE_MAX_AGE_SECONDS,
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

async function authorizeUser(input: {
  request: Request;
  provider: OAuthProvider;
  returnTo: string;
  asJson: boolean;
}) {
  const { request, provider, returnTo, asJson } = input;
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  try {
    const configuration = getOAuthConfiguration(
      provider,
      new URL(request.url).origin,
    );
    const state = createOAuthState({
      userId: user.id,
      returnTo,
    });

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
  let returnTo = url.searchParams.get("returnTo");

  if (request.method !== "GET") {
    try {
      const parsed = sessionBodySchema.safeParse(await request.json());
      if (parsed.success) {
        if (parsed.data.returnTo) returnTo = parsed.data.returnTo;
      }
    } catch {
      // Query-string session starts remain valid.
    }
  }

  return { returnTo: safeReturnTo(returnTo) } as const;
}

export async function startOAuthSession(
  request: Request,
  provider: OAuthProvider,
) {
  const resolved = await parseSessionInput(request);
  if ("error" in resolved) return resolved.error;

  return authorizeUser({
    request,
    provider,
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

export async function pollDeviceOAuth(
  request: Request,
  provider: OAuthProvider,
) {
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
    // Codex authenticates `codex exec` from a `~/.codex/auth.json`, not a bare
    // OAuth token, so store the exchange as the HOSTED_CODEX_SUBSCRIPTION the
    // runtime already consumes rather than an `openai`/OAUTH_TOKEN row.
    await persistCodexSubscriptionFromOAuth({
      userId: user.id,
      tokens,
    });
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

export { oauthCallbackPath };
