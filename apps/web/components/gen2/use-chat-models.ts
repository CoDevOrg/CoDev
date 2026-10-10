"use client";

import { useEffect, useState } from "react";
import {
  GEN2_AGENT_PROVIDERS,
  type Gen2AgentProviderName,
  type Gen2ModelInfo,
} from "@codev/contracts";

import { useGen2ProviderStatus } from "./connect-provider";

type ProviderCatalog = Partial<
  Record<
    Gen2AgentProviderName,
    { connected?: boolean; models?: Gen2ModelInfo[] }
  >
>;

function modelKey(workspaceId: string, provider: Gen2AgentProviderName) {
  return `codev-gen2-model:${workspaceId}:${provider}`;
}

function savedModel(workspaceId: string, provider: Gen2AgentProviderName) {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(modelKey(workspaceId, provider)) ?? "";
  } catch {
    return "";
  }
}

/**
 * The chat's agent and model: which providers the member has connected,
 * their model catalogs, and the model chosen per provider (kept for the tab).
 */
export function useChatModels({
  workspaceId,
  activeProvider,
  connectedProviders,
  providersRevision,
  onActiveProviderChange,
}: {
  workspaceId: string;
  activeProvider?: Gen2AgentProviderName | undefined;
  connectedProviders?: Gen2AgentProviderName[] | undefined;
  providersRevision: number;
  onActiveProviderChange?:
    | ((provider: Gen2AgentProviderName) => void)
    | undefined;
}) {
  const fallback = activeProvider ?? GEN2_AGENT_PROVIDERS[0].id;
  const [agent, setAgent] = useState<Gen2AgentProviderName>(fallback);
  if (activeProvider && activeProvider !== agent) setAgent(activeProvider);
  const [modelsByProvider, setModelsByProvider] = useState<
    Partial<Record<Gen2AgentProviderName, Gen2ModelInfo[]>>
  >({});
  const [detected, setDetected] = useState<Gen2AgentProviderName[]>([]);
  const [selectedModel, setSelectedModel] = useState(() =>
    savedModel(workspaceId, fallback),
  );
  const [appliedModelKey, setAppliedModelKey] = useState("");
  const { status: provider, refresh: refreshProvider } =
    useGen2ProviderStatus(agent);

  useEffect(() => {
    let mounted = true;
    void fetch("/api/gen2/providers?provider=all")
      .then((res) => (res.ok ? res.json() : null))
      .then((value) => {
        const data = value as ProviderCatalog | null;
        if (!mounted || !data) return;
        setDetected(
          GEN2_AGENT_PROVIDERS.filter((entry) => data[entry.id]?.connected).map(
            (entry) => entry.id,
          ),
        );
        setModelsByProvider({
          claude: data.claude?.models ?? [],
          codex: data.codex?.models ?? [],
          cursor: data.cursor?.models ?? [],
        });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [providersRevision]);

  useEffect(() => {
    if (providersRevision > 0) void refreshProvider();
  }, [providersRevision, refreshProvider]);

  const incomingModels = provider?.models;
  const incomingModelKey = `${agent}:${incomingModels?.map((model) => model.id).join("\0") ?? ""}`;
  if (incomingModels && incomingModelKey !== appliedModelKey) {
    setAppliedModelKey(incomingModelKey);
    setModelsByProvider((prev) => ({ ...prev, [agent]: incomingModels }));
  }

  const providerModels = modelsByProvider[agent] ?? [];
  const currentModelItem =
    providerModels.find((model) => model.id === selectedModel) ??
    providerModels[0];

  /** The model a provider would run now: the tab's choice, else its first. */
  function modelFor(id: Gen2AgentProviderName) {
    const models = modelsByProvider[id] ?? [];
    const saved = savedModel(workspaceId, id);
    return models.find((model) => model.id === saved) ?? models[0];
  }

  function selectProvider(next: Gen2AgentProviderName, model?: string) {
    setAgent(next);
    onActiveProviderChange?.(next);
    const chosen = model ?? modelFor(next)?.id ?? "";
    setSelectedModel(chosen);
    try {
      sessionStorage.setItem(modelKey(workspaceId, next), chosen);
    } catch {}
  }

  return {
    agent,
    agentLabel:
      GEN2_AGENT_PROVIDERS.find((entry) => entry.id === agent)?.label ??
      "Agent",
    availableProviders: connectedProviders ?? detected,
    modelsByProvider,
    currentModelItem,
    currentModelLabel:
      currentModelItem?.label ??
      (provider?.modelsError ? "Models unavailable" : "Loading models…"),
    provider,
    refreshProvider,
    modelFor,
    selectProvider,
  };
}

export type ChatModels = ReturnType<typeof useChatModels>;
