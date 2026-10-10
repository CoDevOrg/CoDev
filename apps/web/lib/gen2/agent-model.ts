import "server-only";

import type { Gen2AgentProviderName, Gen2ModelInfo } from "@codev/contracts";

import { getDynamicModelsForProvider } from "../providers/dynamic-models";
import { Gen2LifecycleError } from "./errors";

/** The member's live model catalog for a provider; a failed read is retryable. */
export function loadGen2AgentModels(
  provider: Gen2AgentProviderName,
  userId: string,
) {
  return getDynamicModelsForProvider(provider, userId).catch(() => {
    throw new Gen2LifecycleError(
      "Couldn't load your account's models. Please refresh and try again.",
      503,
    );
  });
}

/**
 * The model a turn may run on: the requested one, or the account's default,
 * only when the member's live catalog offers it. Every agent start checks
 * this before it resolves a credential or reaches the workspace.
 */
export function requireGen2AgentModel(
  models: Gen2ModelInfo[],
  requested: string | undefined,
) {
  const model = requested ?? models[0]?.id;
  if (!model || !models.some((entry) => entry.id === model))
    throw new Gen2LifecycleError(
      "This model isn't available for your connected account. Refresh the model picker and choose an available model.",
      400,
    );
  return model;
}
