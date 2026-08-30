"use client";

import { useState } from "react";

import { OrcaWorkspace } from "@/components/orca-workspace";
import { WorkspaceAgentChat } from "@/components/workspace-agent-chat";

type ChatProvider = "openai" | "anthropic";

/**
 * Agent the embedded IDE opens the workspace's default chat tab with. Follows
 * the member's linked provider so the tab starts on a subscription they can
 * actually use; falls back to Claude inside the bundle when unset.
 */
function defaultAgentForProviders(
  providers: ChatProvider[],
): "claude" | "codex" | undefined {
  if (providers.includes("anthropic")) {
    return "claude";
  }
  if (providers.includes("openai")) {
    return "codex";
  }
  return undefined;
}

export function WorkspaceHome({
  workspaceId,
  repository,
  hasRepository,
  availableProviders,
  canInvite,
}: {
  workspaceId: string;
  repository: string | null;
  hasRepository: boolean;
  availableProviders: ChatProvider[];
  canInvite: boolean;
}) {
  // Codex/Claude chat lives inside the IDE itself (Orca's native agent panes),
  // so the IDE remains the workspace's primary surface.
  const [view, setView] = useState<"chat" | "ide">("ide");

  if (view === "ide") {
    const defaultAgent = defaultAgentForProviders(availableProviders);
    return (
      <OrcaWorkspace
        canInvite={canInvite}
        repository={repository}
        workspaceId={workspaceId}
        {...(defaultAgent ? { defaultAgent } : {})}
      />
    );
  }

  return (
    <WorkspaceAgentChat
      availableProviders={availableProviders}
      hasRepository={hasRepository}
      onOpenIde={() => setView("ide")}
      workspaceId={workspaceId}
    />
  );
}
