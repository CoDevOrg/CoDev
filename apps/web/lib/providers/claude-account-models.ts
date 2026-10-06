import "server-only";
import type { ResolvedSecret } from "./registry";
import { getAnthropicModels } from "./anthropic-models";

export async function getClaudeAccountModels(secret: ResolvedSecret) {
  if (secret.kind !== "api_key" && secret.kind !== "claude_setup_token")
    throw new Error("Claude connection unavailable.");
  const models = await getAnthropicModels({
    provider: "anthropic",
    source: "USER",
    authType: secret.kind === "api_key" ? "API_KEY" : "OAUTH_TOKEN",
    apiKeyOrToken: secret.kind === "api_key" ? secret.apiKey : secret.token,
  });
  return models.map((id) => ({ id, label: id }));
}
