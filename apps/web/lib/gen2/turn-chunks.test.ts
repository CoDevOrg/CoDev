import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  turn: {} as Record<string, unknown>,
  append: vi.fn(),
}));
const awaitable = <T>(value: T) =>
  Object.assign(Promise.resolve(), { returning: async () => value });
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [mocks.turn] }) }),
    }),
    update: () => ({
      set: () => ({ where: () => awaitable([{ sessionId: "session-1" }]) }),
    }),
  }),
}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));
vi.mock("./chats", () => ({ appendGen2ChatMessage: mocks.append }));
vi.mock("./collaboration-events", () => ({
  reconcileGen2CollaborationPaths: vi.fn(async () => undefined),
}));

import { recordGen2TurnChunks } from "./turn-chunks";

const resultEvent = (result: string) =>
  `${JSON.stringify({ type: "result", subtype: "success", is_error: true, result })}\n`;
const TOO_OLD =
  "API Error: 400 Claude Code 2.1.236 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.";

function closingPoll(output: string) {
  return recordGen2TurnChunks({
    sessionId: "session-1",
    chunks: [
      { sequence: 0, dataBase64: Buffer.from(output).toString("base64") },
    ],
    exited: true,
    exitCode: 1,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.turn = {
    sessionId: "session-1",
    workspaceId: "workspace-1",
    chatId: "chat-1",
    userId: "user-1",
    provider: "claude",
    model: "claude-opus-5-5",
    output: "",
    pendingBase64: "",
    exited: false,
  };
  mocks.append.mockImplementation(async ({ body }: { body: string }) => ({
    id: "message-1",
    body,
  }));
});

it("hands a too-old CLI back to the poller instead of saving the raw error", async () => {
  expect(await closingPoll(resultEvent(TOO_OLD))).toEqual({
    reply: "",
    messageId: null,
    cliRequirement: { observedVersion: "2.1.236", minVersion: "2.1.280" },
  });
  expect(mocks.append).not.toHaveBeenCalled();
});

it("still saves any other failure for the member", async () => {
  expect(await closingPoll(resultEvent("API Error: 529 Overloaded"))).toEqual({
    reply: "API Error: 529 Overloaded",
    messageId: "message-1",
  });
});

it("keeps the old behavior for turns recorded before model tracking", async () => {
  mocks.turn = { ...mocks.turn, model: null };
  expect(await closingPoll(resultEvent(TOO_OLD))).toMatchObject({
    reply: TOO_OLD,
  });
});
