import "server-only";

import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { createAmazonBedrockAnthropic } from "@ai-sdk/amazon-bedrock/anthropic";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

import type { AuthProvider } from "@codev/shared-types";

import type { ResolvedCredential } from "./credentials";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
export const DEFAULT_CURSOR_MODEL = "composer-2.5";
const RECENT_OPENAI_FALLBACK_MODELS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
];
const CURSOR_FALLBACK_MODELS = ["composer-2.5", "auto-smart"];
const OPENAI_MODEL_CACHE_TTL_MS = 5 * 60 * 1_000;
const openAIModelCache = new Map<
  string,
  { expiresAt: number; models: string[] }
>();

export function getOpenAIModel() {
  const configured = process.env.CODEV_OPENAI_MODEL?.trim();
  return configured || DEFAULT_OPENAI_MODEL;
}

export function getAgentProvider(): AuthProvider {
  const configured = process.env.CODEV_AGENT_PROVIDER?.trim() || "openai";
  if (
    configured !== "openai" &&
    configured !== "anthropic" &&
    configured !== "bedrock" &&
    configured !== "azure_foundry" &&
    configured !== "cursor"
  ) {
    throw new Error(`Unsupported agent provider: ${configured}.`);
  }
  return configured;
}

export function parseAgentProvider(
  value: string | undefined,
  fallback: AuthProvider = getAgentProvider(),
): AuthProvider {
  const configured = value?.trim() || fallback;
  if (
    configured !== "openai" &&
    configured !== "anthropic" &&
    configured !== "bedrock" &&
    configured !== "azure_foundry" &&
    configured !== "cursor"
  ) {
    throw new Error(`Unsupported agent provider: ${configured}.`);
  }
  return configured;
}

export function getAgentModel(provider: AuthProvider = getAgentProvider()) {
  switch (provider) {
    case "openai":
      return getOpenAIModel();
    case "anthropic":
      return process.env.CODEV_ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-5";
    case "cursor":
      return process.env.CODEV_CURSOR_MODEL?.trim() || DEFAULT_CURSOR_MODEL;
    case "bedrock": {
      const model = process.env.CODEV_BEDROCK_MODEL?.trim();
      if (!model) {
        throw new Error("CODEV_BEDROCK_MODEL is required for Bedrock agents.");
      }
      return model;
    }
    case "azure_foundry": {
      const model = process.env.CODEV_AZURE_FOUNDRY_MODEL?.trim();
      if (!model) {
        throw new Error(
          "CODEV_AZURE_FOUNDRY_MODEL is required for Azure Foundry agents.",
        );
      }
      return model;
    }
    default:
      throw new Error(`Provider ${provider} is not configured for agents.`);
  }
}

function isRecentAgentGPTModel(id: string, created: number, cutoff: Date) {
  return (
    /^gpt-\d/.test(id) &&
    created * 1_000 >= cutoff.getTime() &&
    !/(audio|realtime|transcribe|tts|image|embedding|moderation|search-preview|computer-use|instruct|chat-latest)/i.test(
      id,
    )
  );
}

function openAIModelsUrl(endpointUrl?: string) {
  const baseUrl = (endpointUrl || "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  );
  return baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
}

async function fetchRecentOpenAIModels(credential?: ResolvedCredential) {
  if (!credential?.apiKeyOrToken) return RECENT_OPENAI_FALLBACK_MODELS;

  const cacheKey =
    credential.credentialId ?? openAIModelsUrl(credential.endpointUrl);
  const cached = openAIModelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  try {
    const response = await fetch(openAIModelsUrl(credential.endpointUrl), {
      headers: { Authorization: `Bearer ${credential.apiKeyOrToken}` },
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`OpenAI models request failed with ${response.status}.`);
    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown; created?: unknown }>;
    };
    const models = (payload.data ?? [])
      .filter(
        (model): model is { id: string; created: number } =>
          typeof model.id === "string" &&
          typeof model.created === "number" &&
          isRecentAgentGPTModel(model.id, model.created, cutoff),
      )
      .sort((left, right) => right.created - left.created)
      .map((model) => model.id);
    const available = models.length
      ? [...new Set(models)]
      : RECENT_OPENAI_FALLBACK_MODELS;
    openAIModelCache.set(cacheKey, {
      expiresAt: Date.now() + OPENAI_MODEL_CACHE_TTL_MS,
      models: available,
    });
    return available;
  } catch {
    return RECENT_OPENAI_FALLBACK_MODELS;
  }
}

export async function getSelectableAgentModels(
  provider: AuthProvider = getAgentProvider(),
  credential?: ResolvedCredential,
) {
  const configured = process.env.CODEV_AGENT_MODELS?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  if (configured?.length) return [...new Set(configured)];

  const current = getAgentModel(provider);
  if (provider === "cursor") {
    return [...new Set([current, ...CURSOR_FALLBACK_MODELS])];
  }
  if (provider !== "openai") return [current];
  const models = await fetchRecentOpenAIModels(credential);
  return [...new Set(models)];
}

export async function resolveSelectableAgentModel(
  requested: string | undefined,
  provider: AuthProvider = getAgentProvider(),
  credential?: ResolvedCredential,
) {
  const available = await getSelectableAgentModels(provider, credential);
  const selected = requested?.trim() || getAgentModel(provider);
  if (!available.includes(selected)) {
    throw new Error(`Model ${selected} is not available for this workspace.`);
  }
  return selected;
}

/** Initialize the Vercel AI SDK provider from the already-resolved secret. */
export function createAgentModel(
  credential: ResolvedCredential,
  model = getAgentModel(credential.provider),
) {
  switch (credential.provider) {
    case "openai":
      if (!credential.apiKeyOrToken) {
        throw new Error(
          "The OpenAI credential has no API key or bearer token.",
        );
      }
      return createOpenAI({ apiKey: credential.apiKeyOrToken })(model);
    case "anthropic": {
      if (!credential.apiKeyOrToken) {
        throw new Error(
          "The Anthropic credential has no API key or bearer token.",
        );
      }
      const endpoint = credential.endpointUrl
        ? { baseURL: credential.endpointUrl }
        : {};
      const anthropic = createAnthropic(
        credential.authType === "OAUTH_TOKEN"
          ? { authToken: credential.apiKeyOrToken, ...endpoint }
          : { apiKey: credential.apiKeyOrToken, ...endpoint },
      );
      return anthropic(model);
    }
    case "bedrock": {
      const provider = createAmazonBedrockAnthropic({
        region: process.env.AWS_REGION ?? "us-east-1",
        ...(credential.awsRoleArn
          ? {
              credentialProvider: fromTemporaryCredentials({
                params: {
                  RoleArn: credential.awsRoleArn,
                  RoleSessionName: "codev-agent",
                },
              }),
            }
          : {}),
      });
      return provider(model);
    }
    case "azure_foundry": {
      if (!credential.apiKeyOrToken || !credential.endpointUrl) {
        throw new Error("The Azure Foundry credential is incomplete.");
      }
      return createOpenAI({
        apiKey: credential.apiKeyOrToken,
        baseURL: credential.endpointUrl,
      })(model);
    }
    case "cursor":
      throw new Error(
        "Cursor agents use the Cursor SDK runtime, not the AI SDK model factory.",
      );
    default:
      throw new Error(
        `Provider ${credential.provider} is not configured for agents.`,
      );
  }
}
