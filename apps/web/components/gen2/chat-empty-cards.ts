import type { Gen2Chat } from "@codev/contracts";

import { formatGen2MentionToken } from "@/lib/gen2/prompt-mentions";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

/** A suggestion that fills the composer; it never sends. */
export type ChatEmptyCard = {
  id: string;
  title: string;
  description: string;
  /** Composer text; may hold mention tokens, shown as `@label`. */
  text: string;
};

const ALWAYS: ChatEmptyCard[] = [
  {
    id: "plan",
    title: "Plan before building",
    description: "Investigate first and agree on the steps",
    text: "/plan ",
  },
  {
    id: "goal",
    title: "Set a goal",
    description: "Keep working toward an outcome across turns",
    text: "/goal ",
  },
  {
    id: "tour",
    title: "Show me around",
    description: "Walk through how this app starts",
    text: "Open the main entry point in the file viewer and walk me through how the app starts.",
  },
];

function recentChat(chats: Gen2Chat[], chatId: string | null) {
  return (
    chats
      .filter((chat) => chat.id !== chatId)
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )[0] ?? null
  );
}

/**
 * Empty-state suggestions ranked by what the workspace shows right now:
 * changes to review, a running app, a recent chat, teammates to invite.
 * Without workspace context only the general cards remain.
 */
export function rankChatEmptyCards(
  agentContext: WorkspaceAgentContextValue | null,
  chatId: string | null,
  memberCount: number,
): ChatEmptyCard[] {
  if (!agentContext) return ALWAYS;
  const snapshot = agentContext.getSnapshot();
  const changedFiles = snapshot?.worktree.changedFiles ?? null;
  const previewPort = agentContext.previewEnabled
    ? (snapshot?.preview?.port ?? snapshot?.listeningPorts?.[0] ?? null)
    : null;
  const chat = recentChat(agentContext.sources.chats, chatId);
  const ranked: ChatEmptyCard[] = [];
  if (changedFiles)
    ranked.push({
      id: "review",
      title: `Review my ${changedFiles} changed ${changedFiles === 1 ? "file" : "files"}`,
      description: "Find problems before you commit",
      text: "/review ",
    });
  if (previewPort)
    ranked.push({
      id: "preview",
      title: `Preview :${previewPort}`,
      description: "Open your running app in the browser",
      text: `Open my app on port ${previewPort} in the browser preview.`,
    });
  if (chat)
    ranked.push({
      id: "continue",
      title: `Continue from “${chat.title}”`,
      description: "Pick up where that chat left off",
      text: `Continue from ${formatGen2MentionToken({ kind: "chat", ref: chat.id, label: chat.title })} `,
    });
  if (memberCount <= 1)
    ranked.push({
      id: "invite",
      title: "Invite teammates",
      description: "Build together in this workspace",
      text: "Invite ",
    });
  return [...ranked, ...ALWAYS].slice(0, 6);
}
