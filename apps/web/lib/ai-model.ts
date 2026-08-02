import "server-only";

import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { createAmazonBedrockAnthropic } from "@ai-sdk/amazon-bedrock/anthropic";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

import type { AuthProvider } from "@codev/shared-types";

import type { ResolvedCredential } from "./credentials";

export const DEFAULT_OPENAI_MODEL = "gpt-5";
const DEFAULT_OPENAI_MODELS = [
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.2-codex",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5-pro",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
];

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
    configured !== "azure_foundry"
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

export function getSelectableAgentModels(
  provider: AuthProvider = getAgentProvider(),
) {
  const configured = process.env.CODEV_AGENT_MODELS?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  if (configured?.length) return [...new Set(configured)];

  const current = getAgentModel(provider);
  if (provider === "openai") {
    return [...new Set([current, ...DEFAULT_OPENAI_MODELS])];
  }
  return [current];
}

export function resolveSelectableAgentModel(
  requested: string | undefined,
  provider: AuthProvider = getAgentProvider(),
) {
  const available = getSelectableAgentModels(provider);
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
    default:
      throw new Error(
        `Provider ${credential.provider} is not configured for agents.`,
      );
  }
}
