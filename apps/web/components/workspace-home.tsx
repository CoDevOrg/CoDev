"use client";

import { OrcaWorkspace } from "@/components/orca-workspace";

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
  availableProviders,
  canInvite,
  cursorAvailable,
}: {
  workspaceId: string;
  repository: string | null;
  availableProviders: ChatProvider[];
  canInvite: boolean;
  /** Whether this member has a linked Cursor credential — gates offering it
   *  in the IDE's in-chat provider switcher. */
  cursorAvailable: boolean;
}) {
  // Codex/Claude/Cursor chat lives inside the IDE itself (Orca's native agent
  // panes), so the IDE is the workspace's only surface. The old standalone
  // WorkspaceAgentChat fallback page was retired: nothing has linked to it
  // since the IDE became the default view.
  const defaultAgent = defaultAgentForProviders(availableProviders);
  return (
    <OrcaWorkspace
      canInvite={canInvite}
      cursorAvailable={cursorAvailable}
      repository={repository}
      workspaceId={workspaceId}
      {...(defaultAgent ? { defaultAgent } : {})}
    />
  );
}
