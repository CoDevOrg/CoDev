import { describe, expect, it, vi } from "vitest";

import {
  emptyLiveAgentCards,
  fetchLiveAgentActivity,
  toLiveAgentActivity,
  type LiveAgentContributor,
} from "./live-agent-activity-view";
import { toWorkboardSlots, type WorkboardSession } from "./workboard-view";

const now = new Date("2026-08-15T08:00:00.000Z");

function session(
  overrides: Partial<WorkboardSession> & Pick<WorkboardSession, "id">,
): WorkboardSession {
  return {
    name: "Managed proposal",
    provider: "openai",
    status: "idle",
    worktreeId: `worktree-${overrides.id}`,
    worktreeName: `agent-${overrides.id}`,
    worktreeStatus: "active",
    ownerName: "Alex Morgan",
    ownerLogin: "alex",
    issueTitle: null,
    createdAt: "2026-08-15T07:59:42.000Z",
    turns: [],
    ...overrides,
  };
}

function contributor(
  sessionId: string,
  overrides: Partial<LiveAgentContributor> = {},
): LiveAgentContributor {
  return {
    session: { sessionId },
    ownerName: "Alex Morgan",
    activeTurnAuthorName: null,
    attributedQueue: [],
    transcript: [],
    ...overrides,
  };
}

describe("live agent activity view", () => {
  it("shows three empty slots before any session starts", () => {
    const cards = emptyLiveAgentCards();
    expect(cards).toHaveLength(3);
    expect(cards.every((card) => !card.occupied)).toBe(true);
    expect(cards.map((card) => card.owner)).toEqual([
      "Unassigned",
      "Unassigned",
      "Unassigned",
    ]);
  });

  it("names who started each session and who is working on it", () => {
    const { slots } = toWorkboardSlots(
      [
        session({
          id: "session-1",
          name: "Repository map",
          ownerName: "Alex Morgan",
          status: "running",
          createdAt: "2026-08-15T07:59:42.000Z",
          turns: [{ prompt: "Map the repository layout.", status: "running" }],
        }),
        session({
          id: "session-2",
          name: "Presence replay",
          ownerName: "Jordan Lee",
          provider: "anthropic",
          createdAt: "2026-08-15T07:58:18.000Z",
        }),
      ],
      now,
    );

    const cards = toLiveAgentActivity(slots, [
      contributor("session-1", {
        ownerName: "Alex Morgan",
        activeTurnAuthorName: "Alex Morgan",
        attributedQueue: [{ authorName: "Jordan Lee" }],
        transcript: [{ authorName: "Alex Morgan" }],
      }),
      contributor("session-2", {
        ownerName: "Jordan Lee",
      }),
    ]);

    expect(cards[0]).toMatchObject({
      slot: 1,
      occupied: true,
      assignment: "Repository map",
      owner: "Alex Morgan",
      working: ["Alex Morgan", "Jordan Lee"],
      currentTask: "Map the repository layout.",
    });
    expect(cards[1]).toMatchObject({
      slot: 2,
      occupied: true,
      assignment: "Presence replay",
      owner: "Jordan Lee",
      working: ["Jordan Lee"],
    });
    expect(cards[2]?.occupied).toBe(false);
  });

  it("loads workboard and shared-session payloads into the live snapshot", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/workboard")) {
        return Response.json({
          capacity: {
            maxActiveSessions: 3,
            activeSessions: 1,
            availableSlots: 2,
          },
          slots: toWorkboardSlots(
            [
              session({
                id: "session-1",
                name: "Repository map",
                ownerName: "Alex Morgan",
              }),
            ],
            now,
          ).slots,
        });
      }
      return Response.json({
        sharedSessions: [
          contributor("session-1", {
            attributedQueue: [{ authorName: "Casey Rivera" }],
          }),
        ],
      });
    });

    const snapshot = await fetchLiveAgentActivity("workspace-1", fetcher);

    expect(snapshot.occupied).toBe(1);
    expect(snapshot.max).toBe(3);
    expect(snapshot.cards[0]).toMatchObject({
      assignment: "Repository map",
      owner: "Alex Morgan",
      working: ["Casey Rivera", "Alex Morgan"],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/agents/workboard",
      { cache: "no-store" },
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/agents/shared",
      { cache: "no-store" },
    );
  });
});
