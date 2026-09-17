"use client";

import { OrcaWorkspace } from "@/components/orca-workspace";
import type { WorkspaceProviderPreflight } from "@/lib/provider-surface-capability";

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
  providerPreflight,
  canInvite,
  cursorAvailable,
  initialBranch,
  initialAgent,
}: {
  workspaceId: string;
  repository: string | null;
  availableProviders: ChatProvider[];
  /** What the startup screen tells the member about the agent about to run. */
  providerPreflight: WorkspaceProviderPreflight;
  canInvite: boolean;
  /** Whether this member has a linked Cursor credential — gates offering it
   *  in the IDE's in-chat provider switcher. */
  cursorAvailable: boolean;
  /** Optional branch route carried into the embedded IDE's startup fragment. */
  initialBranch?: string;
  /** Optional managed agent route carried into the embedded IDE. */
  initialAgent?: string;
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
      providerPreflight={providerPreflight}
      repository={repository}
      workspaceId={workspaceId}
      {...(initialBranch ? { initialBranch } : {})}
      {...(initialAgent ? { initialAgent } : {})}
      {...(defaultAgent ? { defaultAgent } : {})}
    />
  );
}
