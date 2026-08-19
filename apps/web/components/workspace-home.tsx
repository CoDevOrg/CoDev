"use client";

import { useState } from "react";

import { OrcaWorkspace } from "@/components/orca-workspace";
import { WorkspaceAgentChat } from "@/components/workspace-agent-chat";

type ChatProvider = "openai" | "anthropic";

export function WorkspaceHome({
  workspaceId,
  repository,
  hasRepository,
  availableProviders,
}: {
  workspaceId: string;
  repository: string | null;
  hasRepository: boolean;
  availableProviders: ChatProvider[];
}) {
  // Codex/Claude chat lives inside the IDE itself (Orca's own agent
  // terminal panes, see public/orca/codev-preload.js), so land here by
  // default rather than on the separate chat page.
  const [view, setView] = useState<"chat" | "ide">("ide");

  if (view === "ide") {
    return <OrcaWorkspace repository={repository} workspaceId={workspaceId} />;
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
