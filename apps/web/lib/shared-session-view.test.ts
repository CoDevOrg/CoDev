import { describe, expect, it } from "vitest";

import {
  CONTROLLED_LAST_ACTION_OUTPUT,
  CONTROLLED_LAST_ACTION_TOOL,
  lastCompletedSharedAction,
  toSharedSessionView,
  type SharedSessionListItem,
} from "./shared-session-view";

const workspaceId = "b0200000-0000-4000-8000-000000000001";
const sessionId = "f3100000-0000-4000-8000-000000000001";
const ownerId = "b0200000-0000-4000-8000-000000000011";
const jordanId = "b0200000-0000-4000-8000-000000000012";
const worktreeId = "f3100000-0000-4000-8000-000000000002";
const completedTurnId = "f3100000-0000-4000-8000-000000000003";
const queuedTurnId = "f3100000-0000-4000-8000-000000000004";
const runningTurnId = "f3100000-0000-4000-8000-000000000005";

function session(
  overrides: Partial<SharedSessionListItem> = {},
): SharedSessionListItem {
  return {
    id: sessionId,
    workspaceId,
    name: "Shared",
    model: "gpt-5",
    provider: "openai",
    status: "running",
    worktreeId,
    worktreeName: "agent-alex",
    createdBy: ownerId,
    ownerName: "Alex Morgan",
    ownerLogin: "alex",
    createdAt: "2026-07-30T12:00:00.000Z",
    turns: [
      {
        id: completedTurnId,
        authorId: ownerId,
        authorName: "Alex Morgan",
        authorLogin: "alex",
        prompt: "Inspect the repository layout.",
        status: "completed",
        output: CONTROLLED_LAST_ACTION_OUTPUT,
        createdAt: "2026-07-30T12:00:00.000Z",
      },
      {
        id: runningTurnId,
        authorId: ownerId,
        authorName: "Alex Morgan",
        authorLogin: "alex",
        prompt: "Controlled shared-session turn",
        status: "running",
        createdAt: "2026-07-30T12:01:00.000Z",
      },
      {
        id: queuedTurnId,
        authorId: jordanId,
        authorName: "Jordan Lee",
        authorLogin: "jordan",
        prompt: "Summarize the collaboration plan.",
        status: "queued",
        createdAt: "2026-07-30T12:02:00.000Z",
      },
    ],
    events: [
      {
        id: "f3100000-0000-4000-8000-000000000006",
        turnId: completedTurnId,
        type: "tool.completed",
        payload: {
          name: CONTROLLED_LAST_ACTION_TOOL,
          text: CONTROLLED_LAST_ACTION_OUTPUT,
        },
        createdAt: "2026-07-30T12:00:30.000Z",
      },
    ],
    ...overrides,
  };
}

describe("shared session view", () => {
  it("maps provider, owner, worktree, queue attribution, and last completed action", () => {
    const view = toSharedSessionView(session());

    expect(view.session).toMatchObject({
      sessionId,
      ownerId,
      worktreeId,
      provider: "openai",
      model: "gpt-5",
      state: "running",
      activeTurnId: runningTurnId,
      streamCursor: 1,
    });
    expect(view.ownerName).toBe("Alex Morgan");
    expect(view.worktreeName).toBe("agent-alex");
    expect(view.attributedQueue).toEqual([
      expect.objectContaining({
        authorId: jordanId,
        authorName: "Jordan Lee",
        prompt: "Summarize the collaboration plan.",
      }),
    ]);
    expect(view.transcript).toEqual([
      expect.objectContaining({
        position: 1,
        authorName: "Alex Morgan",
        prompt: "Inspect the repository layout.",
        status: "completed",
        tool: CONTROLLED_LAST_ACTION_TOOL,
        output: CONTROLLED_LAST_ACTION_OUTPUT,
      }),
    ]);
    expect(lastCompletedSharedAction(session())).toEqual({
      tool: CONTROLLED_LAST_ACTION_TOOL,
      output: CONTROLLED_LAST_ACTION_OUTPUT,
    });
    expect(view.connectionBlocked).toBeNull();
  });

  it("surfaces a revoked provider connection without dropping the transcript", () => {
    const view = toSharedSessionView(
      session({
        status: "idle",
        lastError:
          "This OpenAI connection was revoked or is not connected. Reconnect a key in Settings before starting another turn. The existing session is unchanged.",
      }),
    );

    expect(view.connectionBlocked).toMatch(/OpenAI connection was revoked/);
    expect(view.transcript).toEqual([
      expect.objectContaining({
        status: "completed",
        output: CONTROLLED_LAST_ACTION_OUTPUT,
      }),
    ]);
  });

  it("keeps the queued instruction and last completed action after interrupt", () => {
    const view = toSharedSessionView(
      session({
        status: "interrupted",
        turns: [
          session().turns[0]!,
          {
            ...session().turns[1]!,
            status: "interrupted",
            output: null,
            lastError: null,
          },
          session().turns[2]!,
        ],
      }),
    );

    expect(view.session.state).toBe("interrupted");
    expect(view.session.activeTurnId).toBeNull();
    expect(view.session.queue).toHaveLength(1);
    expect(view.session.queue[0]?.authorId).toBe(jordanId);
    expect(view.transcript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "interrupted",
          prompt: "Controlled shared-session turn",
        }),
      ]),
    );
    expect(view.lastCompletedAction).toEqual({
      tool: CONTROLLED_LAST_ACTION_TOOL,
      output: CONTROLLED_LAST_ACTION_OUTPUT,
    });
  });
});
