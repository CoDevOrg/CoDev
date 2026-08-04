import { describe, expect, it } from "vitest";

import {
  describeAgentActivity,
  mapAgentEventToChatEvent,
  mapSessionToChatItems,
  type AgentChatSession,
} from "./agent-chat";

function session(
  partial: Partial<AgentChatSession> &
    Pick<AgentChatSession, "turns" | "events">,
): AgentChatSession {
  return {
    id: "session-1",
    name: "Atlas",
    ...partial,
  };
}

describe("mapSessionToChatItems", () => {
  it("maps turns to user bubbles and agent.output to assistant bubbles", () => {
    const items = mapSessionToChatItems(
      session({
        turns: [
          {
            id: "turn-1",
            prompt: "Add a README",
            status: "completed",
            output: "Added README",
            lastError: null,
            createdAt: "2026-07-30T12:00:00.000Z",
          },
        ],
        events: [
          {
            id: "ev-start",
            type: "turn.started",
            payload: { prompt: "Add a README" },
            createdAt: "2026-07-30T12:00:01.000Z",
          },
          {
            id: "ev-out",
            type: "agent.output",
            payload: { text: "I added a README with setup steps." },
            createdAt: "2026-07-30T12:00:05.000Z",
          },
          {
            id: "ev-done",
            type: "turn.completed",
            payload: { output: "I added a README with setup steps." },
            createdAt: "2026-07-30T12:00:06.000Z",
          },
        ],
      }),
    );

    expect(items).toEqual([
      { kind: "user", id: "turn:turn-1", text: "Add a README" },
      {
        kind: "assistant",
        id: "assistant:ev-out",
        text: "I added a README with setup steps.",
      },
    ]);
  });

  it("shows consecutive tool events as readable activity rows", () => {
    const items = mapSessionToChatItems(
      session({
        turns: [
          {
            id: "turn-2",
            prompt: "Refactor auth",
            status: "completed",
            output: null,
            lastError: null,
            createdAt: "2026-07-30T13:00:00.000Z",
          },
        ],
        events: [
          {
            id: "t1",
            type: "tool.called",
            payload: { name: "read_file", arguments: "{}" },
            createdAt: "2026-07-30T13:00:02.000Z",
          },
          {
            id: "t2",
            type: "tool.completed",
            payload: { name: "read_file", output: "ok" },
            createdAt: "2026-07-30T13:00:03.000Z",
          },
          {
            id: "t3",
            type: "tool.called",
            payload: { name: "write_file", arguments: "{}" },
            createdAt: "2026-07-30T13:00:04.000Z",
          },
          {
            id: "t4",
            type: "tool.failed",
            payload: { name: "write_file", error: "conflict" },
            createdAt: "2026-07-30T13:00:05.000Z",
          },
          {
            id: "a1",
            type: "agent.output",
            payload: { text: "Auth refactor stalled on a write conflict." },
            createdAt: "2026-07-30T13:00:06.000Z",
          },
        ],
      }),
    );

    expect(items).toEqual([
      { kind: "user", id: "turn:turn-2", text: "Refactor auth" },
      {
        kind: "activities",
        id: "activities:t1",
        activities: [
          {
            category: "file",
            detail: "file",
            id: "t1",
            label: "Read",
            name: "read_file",
            status: "completed",
          },
          {
            category: "file",
            detail: "file",
            id: "t3",
            label: "Could not edit",
            name: "write_file",
            status: "failed",
          },
        ],
      },
      {
        kind: "assistant",
        id: "assistant:a1",
        text: "Auth refactor stalled on a write conflict.",
      },
    ]);
  });

  it("falls back to turn.output when agent.output events are missing", () => {
    const items = mapSessionToChatItems(
      session({
        turns: [
          {
            id: "turn-3",
            prompt: "Say hello",
            status: "completed",
            output: "Hello from the worktree.",
            lastError: null,
            createdAt: "2026-07-30T14:00:00.000Z",
          },
        ],
        events: [],
      }),
    );

    expect(items).toEqual([
      { kind: "user", id: "turn:turn-3", text: "Say hello" },
      {
        kind: "assistant",
        id: "turn-output:turn-3",
        text: "Hello from the worktree.",
      },
    ]);
  });

  it("includes turn errors as error items", () => {
    const items = mapSessionToChatItems(
      session({
        turns: [
          {
            id: "turn-4",
            prompt: "Break things",
            status: "failed",
            output: null,
            lastError: "OpenAI key missing",
            createdAt: "2026-07-30T15:00:00.000Z",
          },
        ],
        events: [],
      }),
    );

    expect(items).toEqual([
      { kind: "user", id: "turn:turn-4", text: "Break things" },
      {
        kind: "error",
        id: "turn-error:turn-4",
        text: "OpenAI key missing",
      },
    ]);
  });

  it("renders reviewer comments with their file location", () => {
    const items = mapSessionToChatItems(
      session({
        turns: [],
        events: [
          {
            id: "comment-1",
            type: "comment.added",
            payload: {
              text: "Please add a regression test.",
              author: "Reviewer",
              filePath: "src/auth.ts",
              lineNumber: 42,
            },
            createdAt: "2026-07-30T16:00:00.000Z",
          },
        ],
      }),
    );

    expect(items).toEqual([
      {
        kind: "comment",
        id: "comment:comment-1",
        text: "Please add a regression test.",
        author: "Reviewer",
        filePath: "src/auth.ts",
        lineNumber: 42,
      },
    ]);
  });
});

describe("mapAgentEventToChatEvent", () => {
  it("maps a durable reviewer comment to a timeline event", () => {
    const event = mapAgentEventToChatEvent({
      id: "comment-2",
      workspaceId: "2f2387ed-4a63-4b05-88cc-266d65f7b82b",
      sessionId: "8f4dd3e4-63a9-4b64-a9e7-97e0c25c77c5",
      turnId: null,
      actor: {
        userId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
        userName: "Reviewer",
        avatarUrl: null,
      },
      modelProvider: "custom",
      modelName: "human-review",
      type: "COMMENT_ADDED",
      payload: {
        commentText: "Please add a regression test.",
        filePath: "src/auth.ts",
        metadata: { lineNumber: 42 },
      },
      timestamp: 1,
    });

    expect(event).toMatchObject({
      type: "comment.added",
      payload: {
        text: "Please add a regression test.",
        author: "Reviewer",
        filePath: "src/auth.ts",
        lineNumber: 42,
      },
    });
  });
});

describe("describeAgentActivity", () => {
  it("turns file and command tools into user-facing progress copy", () => {
    expect(
      describeAgentActivity(
        "read_file",
        JSON.stringify({ path: "apps/web/package.json" }),
        "running",
      ),
    ).toEqual({
      category: "file",
      label: "Reading",
      detail: "apps/web/package.json",
    });

    expect(
      describeAgentActivity(
        "run_command",
        JSON.stringify({ command: ["pnpm", "test", "--", "agent-chat"] }),
        "completed",
      ),
    ).toEqual({
      category: "command",
      label: "Ran",
      detail: "$ pnpm test -- agent-chat",
    });
  });
});
