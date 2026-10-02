import "server-only";

import { authenticateCliRequest, CliAuthError } from "../auth/cli-auth";
import { persistHostedCodexConnection } from "./hosted-codex-subscription-credentials";

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
    authCache?: unknown;
  };
  const authCacheJson = validateCodexAuthCache(input.authCache);
  await persistHostedCodexConnection({
    userId: cli.userId,
    material: { authCacheJson },
    accountLabel: "Codex CLI",
    connectedVia: "cli",
  });
  return { scopeType: "USER", scopeId: cli.userId };
}
