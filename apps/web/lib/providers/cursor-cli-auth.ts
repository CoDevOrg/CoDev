import "server-only";

import { requireOrganizationSettingsWrite } from "../auth/settings-access";
import { authenticateCliRequest, CliAuthError } from "../auth/cli-auth";
import { saveProviderCredential } from "./credentials";

const MAX_AUTH_BYTES = 128 * 1024;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tokenField(value: JsonObject, ...keys: string[]) {
  for (const key of keys) {
    const token = value[key];
    if (typeof token === "string" && token.trim().length >= 20) {
      return token.trim();
    }
  }
  return "";
}

/** The file `agent login` writes when credentials are stored on disk. */
export function validateCursorAuthCache(value: unknown) {
  if (!isObject(value)) {
    throw new CliAuthError("Cursor auth.json must contain a JSON object.");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_AUTH_BYTES) {
    throw new CliAuthError("Cursor auth.json exceeds the 128 KiB limit.", 413);
  }
  const accessToken = tokenField(value, "accessToken", "access_token");
  if (!accessToken) {
    throw new CliAuthError(
      "Cursor auth.json does not contain an access token. Run `agent login` and try again.",
    );
  }
  const refreshToken =
    tokenField(value, "refreshToken", "refresh_token") || accessToken;
  return { accessToken, refreshToken, lastFour: accessToken.slice(-4) };
}

async function cursorScope(
  userId: string,
  scopeType: unknown,
  organizationId: unknown,
) {
  const shared = scopeType === "ORGANIZATION" || scopeType === "WORKSPACE";
  if (!shared) return { scopeType: "USER" as const, scopeId: userId };
  if (typeof organizationId !== "string" || !organizationId) {
    throw new CliAuthError("Organization id is required.");
  }
  try {
    await requireOrganizationSettingsWrite(userId, organizationId);
  } catch {
    throw new CliAuthError(
      "Only an organization maintainer can connect shared Cursor authentication.",
      403,
    );
  }
  return { scopeType: "WORKSPACE" as const, scopeId: organizationId };
}

export async function saveCursorCliAuth(request: Request) {
  const cli = await authenticateCliRequest(request);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_AUTH_BYTES * 2) {
    throw new CliAuthError("Request body is too large.", 413);
  }
  const input = (await request.json().catch(() => ({}))) as {
    auth?: unknown;
    scopeType?: unknown;
    organizationId?: unknown;
  };
  const auth = validateCursorAuthCache(input.auth);
  const scope = await cursorScope(
    cli.userId,
    input.scopeType,
    input.organizationId,
  );
  await saveProviderCredential({
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    provider: "cursor",
    credentialType: "OAUTH_TOKEN",
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    lastFour: auth.lastFour,
    connectedVia: "cli",
  });
  return { scopeType: scope.scopeType, scopeId: scope.scopeId };
}
