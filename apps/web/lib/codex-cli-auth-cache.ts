import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { authenticateCliRequest, CliAuthError } from "./cli-auth";
import { getDatabase } from "./database";
import { persistHostedCodexConnection } from "./hosted-codex-subscription-credentials";
import { requireOrganizationSettingsWrite } from "./settings-access";

const MAX_AUTH_CACHE_BYTES = 128 * 1024;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateCodexAuthCache(value: unknown) {
  if (!isObject(value)) {
    throw new CliAuthError("Codex auth.json must contain a JSON object.");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_AUTH_CACHE_BYTES) {
    throw new CliAuthError("Codex auth.json exceeds the 128 KiB limit.", 413);
  }
  const tokens = value.tokens;
  if (
    !isObject(tokens) ||
    typeof tokens.access_token !== "string" ||
    typeof tokens.refresh_token !== "string"
  ) {
    throw new CliAuthError(
      "Codex auth.json does not contain a ChatGPT access and refresh token. Run `codex login` and try again.",
    );
  }
  return serialized;
}

export async function saveCodexCliAuthCache(request: Request) {
  const cli = await authenticateCliRequest(request);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_AUTH_CACHE_BYTES * 2) {
    throw new CliAuthError("Request body is too large.", 413);
  }
  const input = (await request.json()) as {
    scopeType?: unknown;
    organizationId?: unknown;
    authCache?: unknown;
  };
  const scopeType =
    input.scopeType === "ORGANIZATION" ? "ORGANIZATION" : "USER";
  const scopeId =
    scopeType === "USER"
      ? cli.userId
      : typeof input.organizationId === "string"
        ? input.organizationId
        : "";
  if (!scopeId) throw new CliAuthError("Organization id is required.");
  if (scopeType === "ORGANIZATION") {
    try {
      await requireOrganizationSettingsWrite(cli.userId, scopeId);
    } catch {
      throw new CliAuthError(
        "Only an organization maintainer can connect shared Codex authentication.",
        403,
      );
    }
  }
  const authCacheJson = validateCodexAuthCache(input.authCache);
  await persistHostedCodexConnection({
    userId: cli.userId,
    scopeType,
    scopeId,
    sharingEnabled: scopeType === "ORGANIZATION",
    material: { authCacheJson },
    accountLabel: "Codex CLI",
  });
  return { scopeType, scopeId };
}

export async function listCliOrganizations(request: Request) {
  const cli = await authenticateCliRequest(request);
  return getDatabase()
    .select({
      id: schema.workspaces.id,
      repository: schema.workspaces.repository,
    })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
    )
    .where(
      and(
        eq(schema.workspaceMembers.userId, cli.userId),
        eq(schema.workspaceMembers.accessRole, "owner"),
      ),
    );
}
