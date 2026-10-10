"use client";

import type { Gen2TurnItem, Gen2WorkspaceAction } from "@codev/contracts";

export type PendingWorkspaceAction = {
  key: string;
  chatId: string;
  action: Gen2WorkspaceAction;
  blocker: string | null;
};

export type WorkspaceActionOutcome = {
  state: "done" | "dismissed" | "auto";
  message: string;
};

/**
 * Runs a live turn's navigation actions once and holds its proposals for the
 * member to confirm. `live` is non-null only while this tab drives the turn.
 * Placeholder: the implementation lands with the workspace actions package.
 */
export function useWorkspaceActionDispatch(input: {
  workspaceId: string;
  chatId: string | null;
  live: {
    sessionId: string;
    actionNonce: string | null;
    items: Gen2TurnItem[];
  } | null;
}): {
  pending: PendingWorkspaceAction[];
  resolve(key: string, outcome: "done" | "dismissed", message?: string): void;
  outcomeFor(chatId: string, item: Gen2TurnItem): WorkspaceActionOutcome | null;
  announcement: string;
} {
  void input;
  return {
    pending: [],
    resolve: () => undefined,
    outcomeFor: () => null,
    announcement: "",
  };
}
