import type { Gen2TurnItem } from "@codev/contracts";

import { isWorkspaceNavigation } from "./workspace-action-blocker";
import type { StoredPendingAction } from "./workspace-action-storage";
import type { WorkspaceController } from "./workspace-controller";

/** The turn this tab is driving, as the chat polls it. */
export type LiveWorkspaceTurn = {
  sessionId: string;
  actionNonce: string | null;
  items: Gen2TurnItem[];
};

const WAITS_FOR_COMMAND = "Opens after you run the command";
const OFF_SCREEN = "Arrived while you were in another chat";

/**
 * What to do with the workspace actions this tab has not seen yet. Only
 * valid items carrying the turn's nonce count; the rest are remembered as
 * seen and never acted on. Nothing runs for a turn whose chat is no longer
 * on screen: its actions wait in that chat for the member.
 */
export function planWorkspaceActions(
  live: LiveWorkspaceTurn,
  turn: { chatId: string; onScreen: boolean },
  known: Set<string>,
  controller: WorkspaceController,
) {
  const keyOf = (itemId: string) => `${live.sessionId}:${itemId}`;
  const fresh = live.items.filter(
    (item) => item.kind === "workspaceAction" && !known.has(keyOf(item.id)),
  );
  const nonce = live.actionNonce;
  const trusted = live.items.flatMap((item) =>
    item.kind === "workspaceAction" &&
    item.action &&
    nonce &&
    item.token === nonce
      ? [{ itemId: item.id, action: item.action, token: nonce }]
      : [],
  );
  const runsCommand = trusted.some(
    (entry) => entry.action.type === "run_in_terminal",
  );
  const plan = trusted
    .filter(
      ({ itemId, action }) =>
        fresh.some((item) => item.id === itemId) &&
        action.type !== "update_goal",
    )
    .map(({ itemId, action, token }): StoredPendingAction => {
      let blocker = turn.onScreen
        ? controller.autoRunBlocker(action)
        : OFF_SCREEN;
      if (action.type === "open_preview" && blocker && runsCommand)
        blocker = WAITS_FOR_COMMAND;
      const key = keyOf(itemId);
      const { chatId } = turn;
      return {
        key,
        chatId,
        action,
        blocker,
        itemId,
        token,
        turn: live.sessionId,
      };
    });
  const runs = (entry: StoredPendingAction) =>
    isWorkspaceNavigation(entry.action) && entry.blocker === null;
  return {
    seen: fresh.map((item) => keyOf(item.id)),
    auto: plan.filter(runs),
    queued: plan.filter((entry) => !runs(entry)),
  };
}
