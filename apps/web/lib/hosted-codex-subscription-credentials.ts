import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { schema } from "@codev/db";
import type { HostedCodexScopeType } from "@codev/shared-types";

import { getDatabase } from "./database";
import { recordHostedCodexAuditEvent } from "./hosted-codex-subscription-audit";
import {
  HOSTED_CODEX_ATTEMPT_TTL_MS,
  HOSTED_CODEX_RUNTIME_GRANT_TTL_MS,
  createHostedCodexOpaqueId,
  createHostedCodexPkceVerifier,
  getHostedCodexApprovedConfig,
  hostedCodexPkceChallenge,
  redactHostedCodexAccountLabel,
  safeHostedCodexReturnTo,
  type HostedCodexApprovedConfig,
} from "./hosted-codex-subscription";
import { isHostedCodexSubscriptionEnabled } from "./hosted-codex-subscription-flag";
import {
  HOSTED_CODEX_KIND,
  type HostedCodexPublicStatus,
} from "./hosted-codex-subscription-view";
import { decryptSecret, encryptSecret } from "./kms";

const HOSTED_CODEX_CONTEXT = {
  application: "codev",
  purpose: "hosted-codex-subscription",
};

export const HOSTED_CODEX_DEFAULT_RETURN_TO = "/settings/personal/agents";
export { HOSTED_CODEX_CONTEXT };
export type { HostedCodexPublicStatus } from "./hosted-codex-subscription-view";

export class HostedCodexSubscriptionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "hosted_codex_error",
  ) {
    super(message);
    this.name = "HostedCodexSubscriptionError";
  }
}

export type HostedCodexMaterial = {
  refreshToken?: string;
  accessToken?: string;
  idToken?: string;
  providerSubject?: string;
};

export type HostedCodexRuntimeGrant = {
  id: string;
  credentialId: string;
  workspaceId: string;
  audience: string;
  token: string;
  expiresAt: Date;
};

const refreshLocks = new Map<string, Promise<unknown>>();

function cookieSecret() {
  const secret =
    process.env.AUTH_SECRET ?? process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) {
    throw new HostedCodexSubscriptionError(
      "AUTH_SECRET is required for hosted Codex connection attempts.",
      503,
    );
  }
  return secret;
}

export function hashHostedCodexProviderSubject(subject: string) {
  return createHmac("sha256", cookieSecret()).update(subject).digest("hex");
}

export function sealHostedCodexAttemptCookie(input: {
  attemptId: string;
  userId: string;
  state: string;
}) {
  const payload = Buffer.from(JSON.stringify(input), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", cookieSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function openHostedCodexAttemptCookie(value: string) {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    throw new HostedCodexSubscriptionError("Invalid connection state.", 400);
  }
  const expected = createHmac("sha256", cookieSecret())
    .update(payload)
    .digest("base64url");
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw new HostedCodexSubscriptionError("Invalid connection state.", 400);
  }
  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as { attemptId?: string; userId?: string; state?: string };
  if (!parsed.attemptId || !parsed.userId || !parsed.state) {
    throw new HostedCodexSubscriptionError("Invalid connection state.", 400);
  }
  return parsed as { attemptId: string; userId: string; state: string };
}

async function encryptHostedMaterial(material: HostedCodexMaterial) {
  return encryptSecret(JSON.stringify(material), HOSTED_CODEX_CONTEXT);
}

export async function decryptHostedMaterial(encrypted: string) {
  return JSON.parse(
    await decryptSecret(encrypted, HOSTED_CODEX_CONTEXT),
  ) as HostedCodexMaterial;
}

function requireEnabledConfig() {
  if (!isHostedCodexSubscriptionEnabled()) {
    throw new HostedCodexSubscriptionError(
      "Hosted Codex subscription connection is not enabled.",
      404,
      "hosted_codex_disabled",
    );
  }
  const config = getHostedCodexApprovedConfig();
  if (!config) {
    throw new HostedCodexSubscriptionError(
      "Hosted Codex subscription is not configured.",
      503,
      "hosted_codex_not_configured",
    );
  }
  return config;
}

export async function createHostedCodexConnectionAttempt(input: {
  userId: string;
  scopeType: HostedCodexScopeType;
  scopeId: string;
  returnTo?: string | null;
}) {
  const config = requireEnabledConfig();
  const state = createHostedCodexOpaqueId();
  const codeVerifier = createHostedCodexPkceVerifier();
  const nonce = createHostedCodexOpaqueId();
  const returnTo = safeHostedCodexReturnTo(
    input.returnTo,
    input.scopeType === "ORGANIZATION"
      ? "/settings/org/agents"
      : HOSTED_CODEX_DEFAULT_RETURN_TO,
  );
  const [attempt] = await getDatabase()
    .insert(schema.hostedCodexConnectionAttempts)
    .values({
      userId: input.userId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      returnTo,
      state,
      codeVerifier,
      nonce,
      redirectUri: config.redirectUri,
      expiresAt: new Date(Date.now() + HOSTED_CODEX_ATTEMPT_TTL_MS),
    })
    .returning();
  if (!attempt) {
    throw new HostedCodexSubscriptionError(
      "Could not start a hosted Codex connection.",
      500,
    );
  }
  return {
    attempt,
    config,
    cookie: sealHostedCodexAttemptCookie({
      attemptId: attempt.id,
      userId: input.userId,
      state,
    }),
    codeChallenge: hostedCodexPkceChallenge(codeVerifier),
    nonce,
  };
}

export async function loadValidHostedCodexAttempt(input: {
  cookieValue: string | undefined;
  userId: string;
  state: string;
  redirectUri?: string;
  expectedScopeType?: HostedCodexScopeType;
}) {
  if (!input.cookieValue) {
    throw new HostedCodexSubscriptionError("Missing connection state.", 400);
  }
  const sealed = openHostedCodexAttemptCookie(input.cookieValue);
  if (sealed.userId !== input.userId || sealed.state !== input.state) {
    throw new HostedCodexSubscriptionError(
      "This connection attempt does not belong to the signed-in user.",
      403,
      "hosted_codex_wrong_user",
    );
  }
  const [attempt] = await getDatabase()
    .select()
    .from(schema.hostedCodexConnectionAttempts)
    .where(eq(schema.hostedCodexConnectionAttempts.id, sealed.attemptId))
    .limit(1);
  if (!attempt || attempt.consumedAt) {
    throw new HostedCodexSubscriptionError("Unknown connection attempt.", 400);
  }
  if (attempt.userId !== input.userId) {
    throw new HostedCodexSubscriptionError(
      "This connection attempt does not belong to the signed-in user.",
      403,
      "hosted_codex_wrong_user",
    );
  }
  if (attempt.state !== input.state) {
    throw new HostedCodexSubscriptionError("Invalid connection state.", 400);
  }
  if (attempt.expiresAt.getTime() <= Date.now()) {
    throw new HostedCodexSubscriptionError(
      "This connection attempt has expired.",
      400,
      "hosted_codex_expired",
    );
  }
  if (
    input.expectedScopeType &&
    attempt.scopeType !== input.expectedScopeType
  ) {
    throw new HostedCodexSubscriptionError(
      "This connection attempt was created for a different scope.",
      400,
      "hosted_codex_wrong_scope",
    );
  }
  const config = requireEnabledConfig();
  if (attempt.redirectUri !== config.redirectUri) {
    throw new HostedCodexSubscriptionError("Invalid redirect URI.", 400);
  }
  if (input.redirectUri && input.redirectUri !== config.redirectUri) {
    throw new HostedCodexSubscriptionError("Invalid redirect URI.", 400);
  }
  return { attempt, config };
}

async function consumeAttempt(attemptId: string) {
  await getDatabase()
    .update(schema.hostedCodexConnectionAttempts)
    .set({ consumedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.hostedCodexConnectionAttempts.id, attemptId));
}

function decodeJwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function validateHostedCodexIdToken(input: {
  idToken: string | undefined;
  issuer: string;
  nonce: string;
  clientId: string;
}) {
  if (!input.idToken) return { subject: undefined as string | undefined };
  const payload = decodeJwtPayload(input.idToken);
  if (!payload) {
    throw new HostedCodexSubscriptionError(
      "The identity token could not be validated.",
      400,
      "hosted_codex_invalid_token",
    );
  }
  if (payload.iss !== input.issuer) {
    throw new HostedCodexSubscriptionError(
      "The identity issuer could not be validated.",
      400,
      "hosted_codex_invalid_issuer",
    );
  }
  if (payload.nonce !== input.nonce) {
    throw new HostedCodexSubscriptionError(
      "The identity nonce could not be validated.",
      400,
      "hosted_codex_invalid_nonce",
    );
  }
  const audience = payload.aud;
  const audienceMatches =
    audience === input.clientId ||
    (Array.isArray(audience) && audience.includes(input.clientId));
  if (!audienceMatches) {
    throw new HostedCodexSubscriptionError(
      "The identity audience could not be validated.",
      400,
      "hosted_codex_invalid_audience",
    );
  }
  return {
    subject: typeof payload.sub === "string" ? payload.sub : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

export async function exchangeHostedCodexAuthorizationCode(input: {
  config: HostedCodexApprovedConfig;
  code: string;
  codeVerifier: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.config.redirectUri,
    client_id: input.config.clientId,
    code_verifier: input.codeVerifier,
  });
  if (input.config.clientSecret) {
    body.set("client_secret", input.config.clientSecret);
  }
  const response = await fetch(input.config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new HostedCodexSubscriptionError(
      "The authorization code could not be exchanged.",
      502,
      "hosted_codex_exchange_failed",
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  if (
    typeof payload.refresh_token !== "string" &&
    typeof payload.access_token !== "string"
  ) {
    throw new HostedCodexSubscriptionError(
      "The authorization server returned no credential material.",
      502,
    );
  }
  return {
    accessToken:
      typeof payload.access_token === "string"
        ? payload.access_token
        : undefined,
    refreshToken:
      typeof payload.refresh_token === "string"
        ? payload.refresh_token
        : undefined,
    idToken:
      typeof payload.id_token === "string" ? payload.id_token : undefined,
    expiresIn:
      typeof payload.expires_in === "number" && payload.expires_in > 0
        ? payload.expires_in
        : undefined,
  };
}

export async function persistHostedCodexConnection(input: {
  userId: string;
  scopeType: HostedCodexScopeType;
  scopeId: string;
  sharingEnabled: boolean;
  material: HostedCodexMaterial;
  accountLabel?: string;
  expiresAt?: Date;
}) {
  const encryptedMaterial = await encryptHostedMaterial(input.material);
  const subject = input.material.providerSubject;
  const lastFour = input.accountLabel
    ? redactHostedCodexAccountLabel(input.accountLabel)
    : null;
  await getDatabase()
    .insert(schema.providerCredentials)
    .values({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      provider: "openai",
      credentialType: "HOSTED_CODEX_SUBSCRIPTION",
      priorityOrder: 0,
      encryptedMaterial,
      expiresAt: input.expiresAt,
      isConnected: true,
      keyVersion: 2,
      lastFour,
      status: "active",
      providerSubjectHash: subject
        ? hashHostedCodexProviderSubject(subject)
        : null,
      lastRefreshedAt: new Date(),
      createdBy: input.userId,
      sharingEnabled: input.sharingEnabled,
      unavailableUntil: null,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [
        schema.providerCredentials.scopeType,
        schema.providerCredentials.scopeId,
        schema.providerCredentials.provider,
        schema.providerCredentials.credentialType,
      ],
      set: {
        encryptedMaterial,
        expiresAt: input.expiresAt,
        isConnected: true,
        keyVersion: 2,
        lastFour,
        status: "active",
        providerSubjectHash: subject
          ? hashHostedCodexProviderSubject(subject)
          : null,
        lastRefreshedAt: new Date(),
        createdBy: input.userId,
        sharingEnabled: input.sharingEnabled,
        unavailableUntil: null,
        revokedAt: null,
        updatedAt: new Date(),
      },
    });
  const [credential] = await getDatabase()
    .select()
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, input.scopeType),
        eq(schema.providerCredentials.scopeId, input.scopeId),
        eq(schema.providerCredentials.provider, "openai"),
        eq(
          schema.providerCredentials.credentialType,
          "HOSTED_CODEX_SUBSCRIPTION",
        ),
      ),
    )
    .limit(1);
  await recordHostedCodexAuditEvent({
    credentialId: credential?.id ?? null,
    actorId: input.userId,
    type: "connection_created",
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    result: "success",
  });
  return credential;
}

export async function completeHostedCodexCallback(input: {
  userId: string;
  state: string;
  code: string | null;
  error?: string | null;
  cookieValue: string | undefined;
  callbackRedirectUri: string;
}) {
  const { attempt, config } = await loadValidHostedCodexAttempt({
    cookieValue: input.cookieValue,
    userId: input.userId,
    state: input.state,
    redirectUri: input.callbackRedirectUri,
  });
  await consumeAttempt(attempt.id);
  if (input.error || !input.code) {
    await recordHostedCodexAuditEvent({
      actorId: input.userId,
      type: "authorization_failed",
      scopeType: attempt.scopeType as HostedCodexScopeType,
      scopeId: attempt.scopeId,
      result: "failure",
    });
    throw new HostedCodexSubscriptionError(
      "The hosted Codex connection was not approved.",
      400,
      "hosted_codex_denied",
    );
  }
  const tokens = await exchangeHostedCodexAuthorizationCode({
    config,
    code: input.code,
    codeVerifier: attempt.codeVerifier,
  });
  const identity = validateHostedCodexIdToken({
    idToken: tokens.idToken,
    issuer: config.issuer,
    nonce: attempt.nonce,
    clientId: config.clientId,
  });
  const accountLabel = identity.email ?? identity.subject;
  await persistHostedCodexConnection({
    userId: input.userId,
    scopeType: attempt.scopeType as HostedCodexScopeType,
    scopeId: attempt.scopeId,
    sharingEnabled: attempt.scopeType === "ORGANIZATION",
    material: {
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.accessToken ? { accessToken: tokens.accessToken } : {}),
      ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
      ...(identity.subject ? { providerSubject: identity.subject } : {}),
    },
    ...(accountLabel ? { accountLabel } : {}),
    ...(tokens.expiresIn
      ? { expiresAt: new Date(Date.now() + tokens.expiresIn * 1_000) }
      : {}),
  });
  return { returnTo: attempt.returnTo, scopeType: attempt.scopeType };
}

async function findActiveHostedCredential(
  scopeType: HostedCodexScopeType,
  scopeId: string,
) {
  const now = new Date();
  const [credential] = await getDatabase()
    .select()
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, scopeType),
        eq(schema.providerCredentials.scopeId, scopeId),
        eq(schema.providerCredentials.provider, "openai"),
        eq(
          schema.providerCredentials.credentialType,
          "HOSTED_CODEX_SUBSCRIPTION",
        ),
        eq(schema.providerCredentials.status, "active"),
        eq(schema.providerCredentials.isConnected, true),
      ),
    )
    .limit(1);
  if (!credential) return null;
  if (credential.unavailableUntil && credential.unavailableUntil > now) {
    return null;
  }
  return credential;
}

export async function userBelongsToOrganization(
  userId: string,
  organizationId: string,
) {
  const [membership] = await getDatabase()
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, organizationId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

export async function getHostedCodexPublicStatus(input: {
  scopeType: HostedCodexScopeType;
  scopeId: string;
  canManage: boolean;
}): Promise<HostedCodexPublicStatus> {
  const enabled = isHostedCodexSubscriptionEnabled();
  const [credential] = await getDatabase()
    .select()
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, input.scopeType),
        eq(schema.providerCredentials.scopeId, input.scopeId),
        eq(schema.providerCredentials.provider, "openai"),
        eq(
          schema.providerCredentials.credentialType,
          "HOSTED_CODEX_SUBSCRIPTION",
        ),
      ),
    )
    .limit(1);
  if (!credential || credential.status === "revoked") {
    return {
      kind: HOSTED_CODEX_KIND,
      scopeType: input.scopeType,
      status: enabled ? "not_connected" : "unavailable",
      stateText: enabled
        ? "Not connected"
        : "Unavailable until OpenAI-hosted consent is approved",
      accountLabel: null,
      sharingEnabled: false,
      canManage: input.canManage,
      enabled,
    };
  }
  if (credential.status === "reauthorization_required") {
    return {
      kind: HOSTED_CODEX_KIND,
      scopeType: input.scopeType,
      status: "reauthorization_required",
      stateText: "Reconnect required",
      accountLabel: credential.lastFour,
      sharingEnabled: credential.sharingEnabled,
      canManage: input.canManage,
      enabled,
    };
  }
  return {
    kind: HOSTED_CODEX_KIND,
    scopeType: input.scopeType,
    status: "connected",
    stateText:
      input.scopeType === "ORGANIZATION"
        ? "Connected for this organization"
        : `Connected · ${credential.lastFour ?? "connected account"}`,
    accountLabel: credential.lastFour,
    sharingEnabled: credential.sharingEnabled,
    canManage: input.canManage,
    enabled,
  };
}

export async function resolveHostedCodexSubscription(input: {
  userId: string;
  workspaceId: string;
}) {
  if (!isHostedCodexSubscriptionEnabled()) return null;
  const personal = await findActiveHostedCredential("USER", input.userId);
  if (personal) {
    return { credential: personal, source: "USER" as const };
  }
  const organization = await findActiveHostedCredential(
    "ORGANIZATION",
    input.workspaceId,
  );
  if (
    organization?.sharingEnabled &&
    (await userBelongsToOrganization(input.userId, input.workspaceId))
  ) {
    return { credential: organization, source: "ORGANIZATION" as const };
  }
  return null;
}

async function markCredentialStatus(
  credentialId: string,
  status: "active" | "reauthorization_required" | "revoked" | "failed",
  extra: Record<string, unknown> = {},
) {
  await getDatabase()
    .update(schema.providerCredentials)
    .set({
      status,
      isConnected: status === "active",
      revokedAt: status === "revoked" ? new Date() : undefined,
      updatedAt: new Date(),
      ...extra,
    })
    .where(eq(schema.providerCredentials.id, credentialId));
}

async function refreshHostedMaterial(
  credentialId: string,
  refreshToken: string,
) {
  const config = requireEnabledConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    await markCredentialStatus(credentialId, "reauthorization_required");
    await recordHostedCodexAuditEvent({
      credentialId,
      type: "refresh_failed",
      result: "failure",
    });
    throw new HostedCodexSubscriptionError(
      "Reconnect the Codex subscription in Settings to continue.",
      409,
      "hosted_codex_reauthorization_required",
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  if (typeof payload.access_token !== "string") {
    throw new HostedCodexSubscriptionError(
      "Token refresh returned no runtime credential.",
      502,
    );
  }
  const nextMaterial: HostedCodexMaterial = {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string"
        ? payload.refresh_token
        : refreshToken,
  };
  await getDatabase()
    .update(schema.providerCredentials)
    .set({
      encryptedMaterial: await encryptHostedMaterial(nextMaterial),
      lastRefreshedAt: new Date(),
      expiresAt:
        typeof payload.expires_in === "number"
          ? new Date(Date.now() + payload.expires_in * 1_000)
          : undefined,
      updatedAt: new Date(),
    })
    .where(eq(schema.providerCredentials.id, credentialId));
  await recordHostedCodexAuditEvent({
    credentialId,
    type: "refresh",
    result: "success",
  });
  return nextMaterial;
}

async function withSerializedRefresh<T>(
  credentialId: string,
  work: () => Promise<T>,
) {
  const previous = refreshLocks.get(credentialId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  refreshLocks.set(credentialId, current);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (refreshLocks.get(credentialId) === current) {
      refreshLocks.delete(credentialId);
    }
  }
}

export function shouldReplayDestructiveActionAfterAuthRefresh() {
  return false;
}

export async function mintHostedCodexRuntimeGrant(input: {
  userId: string;
  workspaceId: string;
  audience?: string;
}): Promise<HostedCodexRuntimeGrant> {
  const resolved = await resolveHostedCodexSubscription(input);
  if (!resolved) {
    throw new HostedCodexSubscriptionError(
      "No usable Codex subscription is connected for this workspace.",
      409,
      "hosted_codex_missing",
    );
  }
  const { credential } = resolved;
  if (!credential.encryptedMaterial) {
    throw new HostedCodexSubscriptionError(
      "The Codex subscription has no encrypted material.",
      500,
    );
  }
  const audience = input.audience ?? `workspace:${input.workspaceId}`;
  return withSerializedRefresh(credential.id, async () => {
    await getDatabase().execute(
      sql`select pg_advisory_xact_lock(hashtext(${credential.id}))`,
    );
    const material = await decryptHostedMaterial(credential.encryptedMaterial!);
    let accessToken = material.accessToken;
    const expiresSoon =
      credential.expiresAt &&
      credential.expiresAt.getTime() <= Date.now() + 5 * 60 * 1_000;
    if ((!accessToken || expiresSoon) && material.refreshToken) {
      const refreshed = await refreshHostedMaterial(
        credential.id,
        material.refreshToken,
      );
      accessToken = refreshed.accessToken;
    }
    if (!accessToken) {
      throw new HostedCodexSubscriptionError(
        "The Codex subscription could not mint a runtime grant.",
        409,
      );
    }
    const token = accessToken;
    const expiresAt = new Date(Date.now() + HOSTED_CODEX_RUNTIME_GRANT_TTL_MS);
    const [row] = await getDatabase()
      .insert(schema.hostedCodexRuntimeGrants)
      .values({
        credentialId: credential.id,
        workspaceId: input.workspaceId,
        userId: input.userId,
        audience,
        encryptedGrant: await encryptSecret(
          randomBytes(32).toString("base64url"),
          HOSTED_CODEX_CONTEXT,
        ),
        status: "minted",
        expiresAt,
      })
      .returning();
    if (!row) {
      throw new HostedCodexSubscriptionError(
        "Could not persist a runtime grant.",
        500,
      );
    }
    await recordHostedCodexAuditEvent({
      credentialId: credential.id,
      actorId: input.userId,
      type: "runtime_grant_minted",
      workspaceId: input.workspaceId,
      result: "success",
    });
    return {
      id: row.id,
      credentialId: credential.id,
      workspaceId: input.workspaceId,
      audience,
      token,
      expiresAt,
    };
  });
}

export async function destroyHostedCodexRuntimeGrants(workspaceId: string) {
  const now = new Date();
  await getDatabase()
    .update(schema.hostedCodexRuntimeGrants)
    .set({ status: "revoked", revokedAt: now })
    .where(eq(schema.hostedCodexRuntimeGrants.workspaceId, workspaceId));
  await recordHostedCodexAuditEvent({
    type: "runtime_grant_destroyed",
    workspaceId,
    result: "success",
  });
}

export async function markHostedCodexGrantDelivered(grantId: string) {
  await getDatabase()
    .update(schema.hostedCodexRuntimeGrants)
    .set({ status: "delivered", deliveredAt: new Date() })
    .where(eq(schema.hostedCodexRuntimeGrants.id, grantId));
  await recordHostedCodexAuditEvent({
    type: "runtime_grant_delivered",
    result: "success",
  });
}

export async function markHostedCodexQuotaUnavailable(
  credentialId: string,
  until: Date,
) {
  await markCredentialStatus(credentialId, "failed", {
    unavailableUntil: until,
  });
  await recordHostedCodexAuditEvent({
    credentialId,
    type: "fallback",
    result: "blocked",
  });
}

async function revokeUpstream(refreshToken: string | undefined) {
  const config = getHostedCodexApprovedConfig();
  if (!config?.revocationUrl || !refreshToken) return;
  await fetch(config.revocationUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: refreshToken,
      client_id: config.clientId,
      token_type_hint: "refresh_token",
    }),
    cache: "no-store",
  }).catch(() => undefined);
}

export async function disconnectHostedCodexSubscription(input: {
  userId: string;
  scopeType: HostedCodexScopeType;
  scopeId: string;
}) {
  const [credential] = await getDatabase()
    .select()
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.scopeType, input.scopeType),
        eq(schema.providerCredentials.scopeId, input.scopeId),
        eq(schema.providerCredentials.provider, "openai"),
        eq(
          schema.providerCredentials.credentialType,
          "HOSTED_CODEX_SUBSCRIPTION",
        ),
      ),
    )
    .limit(1);
  if (!credential) return;
  if (credential.encryptedMaterial) {
    const material = await decryptHostedMaterial(
      credential.encryptedMaterial,
    ).catch(() => null);
    await revokeUpstream(material?.refreshToken);
  }
  await getDatabase()
    .update(schema.hostedCodexRuntimeGrants)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(schema.hostedCodexRuntimeGrants.credentialId, credential.id));
  await getDatabase()
    .delete(schema.providerCredentials)
    .where(eq(schema.providerCredentials.id, credential.id));
  await recordHostedCodexAuditEvent({
    credentialId: credential.id,
    actorId: input.userId,
    type: "disconnect",
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    result: "success",
  });
}
