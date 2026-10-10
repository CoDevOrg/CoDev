"use client";

import { ChevronDown } from "lucide-react";
import {
  GEN2_AGENT_PROVIDERS,
  type Gen2AgentProviderName,
  type Gen2ModelInfo,
} from "@codev/contracts";

import { cn } from "@/lib/platform/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProviderLogo } from "./provider-logos";
import type { ChatModels } from "./use-chat-models";
import { WorkspaceButton } from "./workspace-button";

function ModelItems({
  models,
  value,
  onChange,
}: {
  models: Gen2ModelInfo[];
  value: string;
  onChange: (model: string) => void;
}) {
  return (
    <>
      {models.length === 0 ? (
        <DropdownMenuLabel>Account models unavailable</DropdownMenuLabel>
      ) : null}
      <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
        {models.map((model) => (
          <DropdownMenuRadioItem
            key={model.id}
            value={model.id}
            className="cursor-pointer text-xs py-1.5 flex flex-col items-start gap-0.5"
          >
            <span className="font-medium">{model.label}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {model.id}
            </span>
            {model.description ? (
              <span className="text-[10px] text-muted-foreground/80 line-clamp-2">
                {model.description}
              </span>
            ) : null}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

/** The chat's agent and model, chosen per provider from its catalog. */
export function ChatAgentPicker({
  models,
  disabled,
}: {
  models: ChatModels;
  disabled: boolean;
}) {
  const { agent, agentLabel, availableProviders } = models;
  const connected = availableProviders.includes(agent);
  const select = (provider: Gen2AgentProviderName, model?: string) =>
    models.selectProvider(provider, model);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <WorkspaceButton size="toolbar" disabled={disabled} aria-label="Agent">
          {connected ? (
            <ProviderLogo
              provider={agent}
              size={14}
              className="shrink-0 mr-1.5"
            />
          ) : null}
          <span>
            {connected
              ? `${agentLabel} · ${models.currentModelLabel}`
              : availableProviders.length > 0
                ? "Choose a provider"
                : "No provider connected"}
          </span>
          <ChevronDown aria-hidden="true" size={13} />
        </WorkspaceButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="gen2-workspace-surface min-w-[200px]"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1.5">
          Provider & Model
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {GEN2_AGENT_PROVIDERS.filter((entry) =>
          availableProviders.includes(entry.id),
        ).map((entry) => (
          <DropdownMenuSub key={entry.id}>
            <DropdownMenuSubTrigger
              className="cursor-pointer py-1.5 px-2 text-xs flex items-center justify-between"
              onClick={() => select(entry.id)}
            >
              <span
                className={cn(
                  "flex items-center gap-2",
                  agent === entry.id && "font-semibold text-primary",
                )}
              >
                <ProviderLogo
                  provider={entry.id}
                  size={14}
                  className="shrink-0"
                />
                {entry.label}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="gen2-workspace-surface min-w-[220px] max-h-[360px] overflow-y-auto">
              <ModelItems
                models={models.modelsByProvider[entry.id] ?? []}
                value={
                  agent === entry.id ? (models.currentModelItem?.id ?? "") : ""
                }
                onChange={(model) => select(entry.id, model)}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
