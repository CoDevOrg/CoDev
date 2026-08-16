import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import type { HostedCodexScopeType } from "@codev/shared-types";

import { getApiUser } from "./api";
import {
  HOSTED_CODEX_CALLBACK_PATH,
  HOSTED_CODEX_COOKIE_NAME,
  HOSTED_CODEX_ATTEMPT_TTL_MS,
  buildHostedCodexAuthorizationUrl,
  getHostedCodexApprovedConfig,
} from "./hosted-codex-subscription";
import {
  HostedCodexSubscriptionError,
  completeHostedCodexCallback,
  createHostedCodexConnectionAttempt,
  disconnectHostedCodexSubscription,
  getHostedCodexPublicStatus,
} from "./hosted-codex-subscription-credentials";
import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";
import { consumeRateLimit } from "./rate-limit";
import { requireOrganizationSettingsWrite } from "./settings-access";

const scopeTypeSchema = z.enum(["USER", "ORGANIZATION"]);

function rateLimited() {
  return NextResponse.json(
    { error: "Too many hosted Codex connection attempts." },
    { status: 429 },
  );
}

function publicError(error: unknown) {
  if (error instanceof HostedCodexSubscriptionError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: "The hosted Codex connection could not be completed." },
    { status: 500 },
  );
}

function setAttemptCookie(response: NextResponse, value: string) {
  response.cookies.set({
    name: HOSTED_CODEX_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: HOSTED_CODEX_ATTEMPT_TTL_MS / 1_000,
    path: "/api/auth/hosted-codex",
  });
  return response;
}

function clearAttemptCookie(response: NextResponse) {
  response.cookies.set({
    name: HOSTED_CODEX_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/api/auth/hosted-codex",
  });
  return response;
}

function redirectToSettings(
  request: Request,
  status: "connected" | "denied" | "error" | "unavailable",
  returnTo: string,
) {
  const url = new URL(returnTo, request.url);
  url.searchParams.set("hostedCodex", status);
  return clearAttemptCookie(NextResponse.redirect(url));
}

async function authorizeHostedScope(input: {
  userId: string;
  scopeType: HostedCodexScopeType;
  scopeId: string;
  confirmOrganizationScope?: boolean;
}) {
  if (input.scopeType === "USER" && input.scopeId !== input.userId) {
    throw new HostedCodexSubscriptionError(
      "Personal Codex connections can only be created for the signed-in user.",
      403,
    );
  }
  if (input.scopeType === "ORGANIZATION") {
    if (!input.confirmOrganizationScope) {
      throw new HostedCodexSubscriptionError(
        "An administrator must confirm organization scope before connecting Codex.",
        400,
        "hosted_codex_org_confirmation_required",
      );
    }
    await requireOrganizationSettingsWrite(input.userId, input.scopeId);
  }
}

export async function startHostedCodexConnection(request: Request) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  if (!isHostedCodexSubscriptionEnabled()) {
    return NextResponse.json(
      { error: "Hosted Codex subscription connection is not enabled." },
      { status: 404 },
    );
  }
  const limit = await consumeRateLimit(
    user.id,
    "hosted-codex-connect",
    10,
    3600,
  );
  if (!limit.allowed) return rateLimited();

  const url = new URL(request.url);
  const parsed = scopeTypeSchema.safeParse(
    url.searchParams.get("scopeType") ?? "USER",
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scope." }, { status: 400 });
  }
  const scopeType = parsed.data;
  const scopeId =
    scopeType === "ORGANIZATION"
      ? (url.searchParams.get("organizationId") ?? "")
      : user.id;
  if (
    scopeType === "ORGANIZATION" &&
    !z.string().uuid().safeParse(scopeId).success
  ) {
    return NextResponse.json(
      { error: "An organization is required." },
      { status: 400 },
    );
  }
  try {
    await authorizeHostedScope({
      userId: user.id,
      scopeType,
      scopeId,
      confirmOrganizationScope:
        url.searchParams.get("confirmOrganizationScope") === "true",
    });
    const started = await createHostedCodexConnectionAttempt({
      userId: user.id,
      scopeType,
      scopeId,
      returnTo: url.searchParams.get("returnTo"),
    });
    const authorizeUrl = buildHostedCodexAuthorizationUrl({
      config: started.config,
      state: started.attempt.state,
      codeChallenge: started.codeChallenge,
      nonce: started.nonce,
      scopeType,
    });
    return setAttemptCookie(
      NextResponse.redirect(authorizeUrl),
      started.cookie,
    );
  } catch (error) {
    return publicError(error);
  }
}

export async function finishHostedCodexConnection(request: Request) {
  const user = await getApiUser();
  const url = new URL(request.url);
  const returnTo = "/settings/personal/agents";
  if (!user) {
    return redirectToSettings(request, "error", returnTo);
  }
  if (!isHostedCodexSubscriptionEnabled()) {
    return redirectToSettings(request, "unavailable", returnTo);
  }
  const limit = await consumeRateLimit(
    user.id,
    "hosted-codex-callback",
    20,
    3600,
  );
  if (!limit.allowed) return rateLimited();

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const cookieStore = await cookies();
  const config = getHostedCodexApprovedConfig();
  const callbackRedirectUri =
    config?.redirectUri ?? `${url.origin}${HOSTED_CODEX_CALLBACK_PATH}`;
  try {
    const completed = await completeHostedCodexCallback({
      userId: user.id,
      state,
      code,
      error,
      cookieValue: cookieStore.get(HOSTED_CODEX_COOKIE_NAME)?.value,
      callbackRedirectUri,
    });
    return redirectToSettings(request, "connected", completed.returnTo);
  } catch (caught) {
    if (
      caught instanceof HostedCodexSubscriptionError &&
      caught.code === "hosted_codex_denied"
    ) {
      return redirectToSettings(request, "denied", returnTo);
    }
    return redirectToSettings(request, "error", returnTo);
  }
}

export async function disconnectHostedCodexConnection(request: Request) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    scopeType?: string;
    organizationId?: string;
  };
  const parsed = scopeTypeSchema.safeParse(body.scopeType ?? "USER");
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scope." }, { status: 400 });
  }
  const scopeType = parsed.data;
  const scopeId =
    scopeType === "ORGANIZATION" ? (body.organizationId ?? "") : user.id;
  try {
    if (scopeType === "ORGANIZATION") {
      await requireOrganizationSettingsWrite(user.id, scopeId);
    }
    await disconnectHostedCodexSubscription({
      userId: user.id,
      scopeType,
      scopeId,
    });
    return NextResponse.json({
      status: "disconnected",
      kind: "hosted_codex_subscription",
    });
  } catch (error) {
    return publicError(error);
  }
}

export async function hostedCodexStatusResponse(input: {
  userId: string;
  scopeType: HostedCodexScopeType;
  scopeId: string;
  canManage: boolean;
}) {
  const status = await getHostedCodexPublicStatus(input);
  return NextResponse.json(status);
}
