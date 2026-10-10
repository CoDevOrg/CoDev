import { describe, expect, it, vi } from "vitest";
import type { Gen2Chat, Gen2WorkspaceContext } from "@codev/contracts";

import { rankChatEmptyCards } from "./chat-empty-cards";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

function context(
  snapshot: Partial<Gen2WorkspaceContext>,
  chats: Gen2Chat[] = [],
  previewEnabled = false,
) {
  return {
    previewEnabled,
    getSnapshot: () =>
      ({
        worktree: {
          id: "main",
          branch: "main",
          changedFiles: 0,
          unsavedEdits: false,
        },
        preview: null,
        listeningPorts: null,
        ...snapshot,
      }) as Gen2WorkspaceContext,
    sources: { chats },
    controller: { run: vi.fn() },
  } as unknown as WorkspaceAgentContextValue;
}

const chat = (id: string, title: string, updatedAt: string): Gen2Chat => ({
  id,
  title,
  provider: "codex",
  createdAt: updatedAt,
  updatedAt,
});

const ids = (cards: ReturnType<typeof rankChatEmptyCards>) =>
  cards.map((card) => card.id);

describe("rankChatEmptyCards", () => {
  it("keeps the general cards outside the workspace", () => {
    expect(ids(rankChatEmptyCards(null, null, 1))).toEqual([
      "plan",
      "goal",
      "tour",
    ]);
  });

  it("puts what the workspace shows first, up to six cards", () => {
    const cards = rankChatEmptyCards(
      context(
        {
          worktree: {
            id: "main",
            branch: "main",
            changedFiles: 3,
            unsavedEdits: false,
          },
          listeningPorts: [5173],
        },
        [
          chat("a", "Older", "2026-09-01T00:00:00.000Z"),
          chat("b", "Fix login", "2026-09-02T00:00:00.000Z"),
          chat("current", "This one", "2026-09-03T00:00:00.000Z"),
        ],
        true,
      ),
      "current",
      1,
    );
    expect(ids(cards)).toEqual([
      "review",
      "preview",
      "continue",
      "invite",
      "plan",
      "goal",
    ]);
    expect(cards[0]).toMatchObject({
      title: "Review my 3 changed files",
      text: "/review ",
    });
    expect(cards[1]).toMatchObject({
      title: "Preview :5173",
      text: "Open my app on port 5173 in the browser preview.",
    });
    expect(cards[2]).toMatchObject({
      title: "Continue from “Fix login”",
      text: "Continue from @[Fix login](chat:b) ",
    });
    expect(cards[3]).toMatchObject({ text: "Invite " });
  });

  it("never promises a preview that is not enabled, or invites to a team", () => {
    const cards = rankChatEmptyCards(
      context({ listeningPorts: [3000] }),
      null,
      3,
    );
    expect(ids(cards)).toEqual(["plan", "goal", "tour"]);
  });
});
