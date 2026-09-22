import "server-only";

import type {
  Gen2ChatMessage,
  Gen2ProviderId,
  Gen2ProviderReadiness,
} from "@codev/contracts";

import { Gen2LifecycleError } from "./errors";
import { getGen2ProviderDefinition } from "./provider-catalog";
import { openAiGen2ProviderAdapter } from "./providers/openai";

export type Gen2ProviderPollResult = {
  chunks: Array<{ sequence: number; dataBase64: string }>;
  nextSequence: number;
  exited: boolean;
  exitCode: number | null;
};

export type Gen2ProviderTurnInput = {
  workspaceId: string;
  userId: string;
  prompt: string;
  history: Gen2ChatMessage[];
  idempotencyKey: string;
};

/**
 * A provider owns its credential transport and guest protocol. The Gen 2
 * agent service only owns authorization, durable transcript state, and the
 * provider-neutral turn lifecycle.
 */
export type Gen2ProviderAdapter = {
  id: Gen2ProviderId;
  getReadiness(userId: string): Promise<Gen2ProviderReadiness>;
  start(input: Gen2ProviderTurnInput): Promise<{ sessionId: string }>;
  poll(input: {
    workspaceId: string;
    turnOwnerId: string;
    sessionId: string;
    after: number;
  }): Promise<Gen2ProviderPollResult>;
  cancel(input: {
    workspaceId: string;
    turnOwnerId: string;
    sessionId: string;
  }): Promise<void>;
  release(turnOwnerId: string): Promise<void>;
};

const adapters: Partial<Record<Gen2ProviderId, Gen2ProviderAdapter>> = {
  openai: openAiGen2ProviderAdapter,
};

export function getGen2ProviderAdapter(provider: Gen2ProviderId) {
  const adapter = adapters[provider];
  if (adapter) return adapter;
  const definition = getGen2ProviderDefinition(provider);
  throw new Gen2LifecycleError(
    `${definition.label} is not available in Gen 2 yet.`,
    409,
  );
}

/** Returns every known provider, with only redacted readiness information. */
export async function listGen2ProviderReadiness(userId: string) {
  const { gen2ProviderCatalog } = await import("./provider-catalog");
  return Promise.all(
    gen2ProviderCatalog.map(async (definition) => {
      const adapter = adapters[definition.id];
      return adapter
        ? adapter.getReadiness(userId)
        : { ...definition, ready: false };
    }),
  );
}
