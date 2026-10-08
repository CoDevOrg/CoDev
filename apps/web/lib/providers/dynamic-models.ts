import "server-only";
import type { Gen2AgentProviderName, Gen2ModelInfo } from "@codev/contracts";
import { requireCredential } from "./resolve";
import { getCodexAccountModels } from "./codex-account-models";
import { getCursorAccountModels } from "./cursor-account-models";
import { getClaudeAccountModels } from "./claude-account-models";
import { getRelayedCodexAccountModels } from "./model-catalog-relay";
import { freshCodexSecret } from "./codex-token-refresh";

const cache = new Map<string, { expiresAt: number; models: Gen2ModelInfo[] }>();
const discover = {
  codex: getCodexAccountModels,
  cursor: getCursorAccountModels,
  claude: getClaudeAccountModels,
};
/** Cache only account results, keyed by member, provider and credential fingerprint. */
export async function getDynamicModelsForProvider(
  provider: Gen2AgentProviderName,
  userId: string,
): Promise<Gen2ModelInfo[]> {
  if (
    provider === "codex" &&
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  )
    return getRelayedCodexAccountModels(userId);
  const credential = await requireCredential({
    userId,
    provider,
    surface: "gen2",
  });
  const secret =
    provider === "codex"
      ? await freshCodexSecret(credential)
      : credential.secret;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(secret)),
  );
  const fingerprint = Buffer.from(digest).toString("hex");
  const key = `${userId}:${provider}:${fingerprint}`;
  const previous = cache.get(key);
  if (previous && previous.expiresAt > Date.now()) return previous.models;
  const models = await discover[provider](secret);
  if (!models.length) throw new Error("No account models are available.");
  for (const [entry, value] of cache)
    if (value.expiresAt <= Date.now()) cache.delete(entry);
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(key, { expiresAt: Date.now() + 60_000, models });
  return models;
}
export function clearDynamicModelCache() {
  cache.clear();
}
