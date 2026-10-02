import "server-only";

import { authenticateCliRequest, CliAuthError } from "../auth/cli-auth";
import { saveProviderCredential } from "./credentials";

const MAX_AUTH_BYTES = 128 * 1024;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function accessToken(value: JsonObject) {
  const token = value.accessToken ?? value.access_token;
  return typeof token === "string" ? token.trim() : "";
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
  const token = accessToken(value);
  if (token.length < 20) {
    throw new CliAuthError(
      "Cursor auth.json does not contain an access token. Run `agent login` and try again.",
    );
  }
  return { serialized, lastFour: token.slice(-4) };
}

export async function saveCursorCliAuth(request: Request) {
  const cli = await authenticateCliRequest(request);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_AUTH_BYTES * 2) {
    throw new CliAuthError("Request body is too large.", 413);
  }
  const input = (await request.json().catch(() => ({}))) as { auth?: unknown };
  const auth = validateCursorAuthCache(input.auth);
  await saveProviderCredential({
    userId: cli.userId,
    provider: "cursor",
    credentialType: "OAUTH_TOKEN",
    accessToken: auth.serialized,
    lastFour: auth.lastFour,
    connectedVia: "cli",
  });
  return { scopeType: "USER" as const, scopeId: cli.userId };
}
