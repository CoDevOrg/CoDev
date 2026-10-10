import {
  GEN2_WORKSPACE_CONTEXT_LIMITS,
  type Gen2WorkspaceContext,
} from "@codev/contracts";

import { parseGen2MentionTokens } from "@/lib/gen2/prompt-mentions";
import type { ComposerMention } from "./use-composer-mentions";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

const LIMITS = GEN2_WORKSPACE_CONTEXT_LIMITS;

function excerptText(
  mention: ComposerMention,
  agentContext: WorkspaceAgentContextValue,
) {
  if (mention.kind === "selection")
    return (mention.excerpt ?? "").slice(0, LIMITS.excerptChars);
  // The terminal as it is now, falling back to when it was mentioned.
  const tail = agentContext.sources.terminalTail();
  const text = tail?.worktreeId === mention.ref ? tail.text : mention.excerpt;
  return (text ?? "").slice(-LIMITS.excerptChars);
}

/**
 * The snapshot sent with a turn: what the member sees, plus the text of the
 * selection or terminal output they @-mentioned in this prompt. Null outside
 * the workspace shell, where the turn goes without one.
 */
export function buildChatTurnContext(
  agentContext: WorkspaceAgentContextValue | null,
  prompt: string,
  mentions: ComposerMention[],
): Gen2WorkspaceContext | null {
  const snapshot = agentContext?.getSnapshot();
  if (!agentContext || !snapshot) return null;
  const sent = new Set(
    parseGen2MentionTokens(prompt).map((token) => `${token.kind}:${token.ref}`),
  );
  const excerpts = mentions
    .filter(
      (mention) =>
        (mention.kind === "selection" || mention.kind === "terminal") &&
        sent.has(`${mention.kind}:${mention.ref}`),
    )
    .map((mention) => ({
      kind: mention.kind as "selection" | "terminal",
      ref: mention.ref.slice(0, 1024),
      text: excerptText(mention, agentContext),
    }))
    .filter((excerpt) => excerpt.text)
    .slice(0, LIMITS.excerpts);
  return { ...snapshot, excerpts };
}
