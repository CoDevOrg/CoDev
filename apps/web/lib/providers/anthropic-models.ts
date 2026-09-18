import "server-only";

import { z } from "zod";
import type { ResolvedCredential } from "./credentials";

const catalogSchema = z.object({
  data: z.array(z.object({ id: z.string().startsWith("claude-") })),
  has_more: z.boolean(),
  last_id: z.string().nullable(),
});
const cache = new Map<string, { expiresAt: number; models: string[] }>();

/** Discover actual provider IDs; catalog availability does not prove inference entitlement. */
export async function getAnthropicModels(credential: ResolvedCredential) {
  if (!credential.apiKeyOrToken)
    throw new Error("Claude connection unavailable.");
  const base = (
    credential.endpointUrl ?? "https://api.anthropic.com/v1"
  ).replace(/\/+$/, "");
  const key = credential.credentialId
    ? `${credential.credentialId}:${base}:${credential.authType}`
    : undefined;
  const cached = key ? cache.get(key) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const models: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${base}/models`);
    url.searchParams.set("limit", "1000");
    if (after) url.searchParams.set("after_id", after);
    const headers: Record<string, string> = {
      "anthropic-version": "2023-06-01",
    };
    if (credential.authType === "OAUTH_TOKEN") {
      headers.authorization = `Bearer ${credential.apiKeyOrToken}`;
      headers["anthropic-beta"] = "oauth-2025-04-20";
    } else headers["x-api-key"] = credential.apiKeyOrToken;
    const response = await fetch(url.toString(), {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Claude model discovery is unavailable.");
    const catalog = catalogSchema.parse(await response.json());
    models.push(...catalog.data.map(({ id }) => id));
    if (!catalog.has_more) {
      const available = [...new Set(models)];
      if (!available.length) throw new Error("No Claude models are available.");
      if (key)
        cache.set(key, { expiresAt: Date.now() + 300000, models: available });
      return available;
    }
    if (!catalog.last_id || catalog.last_id === after) break;
    after = catalog.last_id;
  }
  throw new Error("Claude model discovery is incomplete.");
}
