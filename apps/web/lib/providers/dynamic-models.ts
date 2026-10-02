import "server-only";

import {
  GEN2_PROVIDER_MODELS,
  type Gen2AgentProviderName,
  type Gen2ModelInfo,
} from "@codev/contracts";

const CACHE_TTL_MS = 10 * 60 * 1_000; // 10 minutes
const cache = new Map<string, { expiresAt: number; models: Gen2ModelInfo[] }>();

type RawOpenRouterModel = {
  id: string;
  name: string;
  created?: number;
  description?: string;
};

function parseClaudeModel(raw: RawOpenRouterModel): Gen2ModelInfo {
  const id = raw.id.replace(/^anthropic\//, "");
  const label = raw.name.replace(/^Anthropic:\s*/, "");
  const description = raw.description
    ? raw.description.slice(0, 90).trim() + "…"
    : undefined;
  return { id, label, description };
}

function parseCodexModel(raw: RawOpenRouterModel): Gen2ModelInfo {
  const id = raw.id.replace(/^openai\//, "");
  const label = raw.name.replace(/^OpenAI:\s*/, "");
  const description = raw.description
    ? raw.description.slice(0, 90).trim() + "…"
    : undefined;
  return { id, label, description };
}

async function fetchPublicCatalog(): Promise<RawOpenRouterModel[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) {
    throw new Error(
      `Public models registry returned status ${response.status}`,
    );
  }
  const payload = (await response.json()) as { data?: RawOpenRouterModel[] };
  return payload.data ?? [];
}

function extractClaudeModels(allModels: RawOpenRouterModel[]): Gen2ModelInfo[] {
  return allModels
    .filter(
      (m) =>
        m.id.startsWith("anthropic/claude-") &&
        !m.id.includes(":batch") &&
        !m.id.includes("latest"),
    )
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .map(parseClaudeModel);
}

function extractCodexModels(allModels: RawOpenRouterModel[]): Gen2ModelInfo[] {
  return allModels
    .filter(
      (m) =>
        m.id.startsWith("openai/") &&
        !m.id.includes(":batch") &&
        !m.id.includes("latest") &&
        !/(audio|image|realtime|transcribe|tts|embedding|moderation|safeguard)/i.test(
          m.id,
        ),
    )
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .map(parseCodexModel);
}

export async function getDynamicModelsForProvider(
  provider: Gen2AgentProviderName,
): Promise<Gen2ModelInfo[]> {
  const cached = cache.get(provider);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }

  const fallback = GEN2_PROVIDER_MODELS[provider] ?? [];
  try {
    const rawCatalog = await fetchPublicCatalog();
    const models =
      provider === "claude"
        ? extractClaudeModels(rawCatalog)
        : extractCodexModels(rawCatalog);

    const result = models.length > 0 ? models : fallback;
    cache.set(provider, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      models: result,
    });
    return result;
  } catch {
    return fallback;
  }
}

/** Clear cache (useful in unit tests). */
export function clearDynamicModelCache(): void {
  cache.clear();
}
