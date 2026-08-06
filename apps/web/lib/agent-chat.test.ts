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
        turnId: "turn-1",
        tokens: {
          inputTokens: 0,
          outputTokens: 9,
          totalTokens: 9,
        },
        tokensEstimated: true,
      },
    ]);
  });

  it("attaches reported token usage from turn.completed", () => {
    const items = mapSessionToChatItems(
      session({
        turns: [
          {
            id: "turn-usage",
            prompt: "Ship it",
            status: "completed",
            output: "Shipped",
            lastError: null,
            createdAt: "2026-07-30T12:00:00.000Z",
          },
        ],
        events: [
          {
            id: "ev-out-usage",
            type: "agent.output",
            payload: { text: "Shipped cleanly." },
            createdAt: "2026-07-30T12:00:05.000Z",
          },
          {
            id: "ev-done-usage",
            type: "turn.completed",
            payload: {
              output: "Shipped cleanly.",
              usage: {
                inputTokens: 120,
                outputTokens: 40,
                totalTokens: 160,
              },
            },
            createdAt: "2026-07-30T12:00:06.000Z",
          },
        ],
      }),
    );

    expect(items).toEqual([
      { kind: "user", id: "turn:turn-usage", text: "Ship it" },
      {
        kind: "assistant",
        id: "assistant:ev-out-usage",
        text: "Shipped cleanly.",
        turnId: "turn-usage",
        tokens: {
          inputTokens: 120,
          outputTokens: 40,
          totalTokens: 160,
        },
        tokensEstimated: false,
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
        kind: "assistant",
        id: "assistant:a1",
        text: "Auth refactor stalled on a write conflict.",
        turnId: "turn-2",
        tokens: {
          inputTokens: 0,
          outputTokens: 11,
          totalTokens: 11,
        },
        tokensEstimated: true,
      },
    ]);
  });

  it("shows only terminal command activities in the chat feed", () => {
    const items = mapSessionToChatItems(
      session({
        turns: [
          {
            id: "turn-cmd",
            prompt: "Check git",
            status: "completed",
            output: null,
            lastError: null,
            createdAt: "2026-07-30T13:00:00.000Z",
          },
        ],
        events: [
          {
            id: "c1",
            type: "tool.called",
            payload: {
              name: "claim_path",
              arguments: JSON.stringify({ path: "README.md" }),
            },
            createdAt: "2026-07-30T13:00:01.000Z",
          },
          {
            id: "c2",
            type: "tool.called",
            payload: {
              name: "run_command",
              arguments: JSON.stringify({
                command: ["git", "status", "--short"],
              }),
            },
            createdAt: "2026-07-30T13:00:02.000Z",
          },
          {
            id: "c3",
            type: "tool.completed",
            payload: { name: "run_command", output: "ok" },
            createdAt: "2026-07-30T13:00:03.000Z",
          },
          {
            id: "c4",
            type: "tool.failed",
            payload: {
              name: "run_command",
              error: "exit 1",
            },
            createdAt: "2026-07-30T13:00:04.000Z",
          },
        ],
      }),
    );

    expect(items).toEqual([
      { kind: "user", id: "turn:turn-cmd", text: "Check git" },
      {
        kind: "activities",
        id: "activities:c2",
        activities: [
          {
            category: "command",
            detail: "$ git status --short",
            id: "c2",
            label: "Ran",
            name: "run_command",
            status: "completed",
          },
          {
            category: "command",
            detail: "command",
            id: "c4",
            label: "Command failed",
            name: "run_command",
            status: "failed",
          },
        ],
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
        turnId: "turn-3",
        tokens: {
          inputTokens: 0,
          outputTokens: 6,
          totalTokens: 6,
        },
        tokensEstimated: true,
      },
    ]);
  });

  it("keeps attachment metadata out of the visible prompt", () => {
    const items = mapSessionToChatItems(
      session({
        turns: [
          {
            id: "turn-attachment",
            prompt:
              "What is this image?\n\nAttached file: Screenshot.png (image/png, 37488 bytes)\n<file-content>Binary content was attached by the user; use the filename and type as context.</file-content>",
            attachments: [],
            status: "completed",
            output: "It is a screenshot.",
            lastError: null,
            createdAt: "2026-07-30T14:30:00.000Z",
          },
        ],
        events: [],
      }),
    );

    expect(items[0]).toEqual({
      kind: "user",
      id: "turn:turn-attachment",
      text: "What is this image?",
      attachments: [{ name: "Screenshot.png", type: "image/png", size: 37488 }],
    });
    expect(JSON.stringify(items)).not.toContain("file-content");
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
