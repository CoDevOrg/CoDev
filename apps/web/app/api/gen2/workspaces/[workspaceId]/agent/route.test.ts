import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/lib/http/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
  getApiUserAnyAuth: mocks.getApiUser,
}));

vi.mock("@/lib/gen2/agent", () => ({
  startGen2AgentTurn: mocks.start,
  cancelGen2AgentTurn: mocks.cancel,
}));

import { POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const chatId = "4d6e8b10-2c4a-4f1e-9a77-0b1c2d3e4f50";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/agent`;

const post = (body: unknown, origin = "https://codev.test") =>
  POST(
    new Request(url, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params },
  );

const turn = {
  chatId,
  provider: "claude",
  prompt: "/plan Add caching",
  idempotencyKey: "turn-12345678",
};

describe("gen2 agent route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
    mocks.start.mockResolvedValue({
      sessionId: "session-1",
      actionNonce: "abcdefghij",
    });
  });
  afterEach(() => vi.resetAllMocks());

  it("passes the member's view through for the library to check", async () => {
    // Deliberately not a valid snapshot: the route never rejects a turn for
    // it; the library parses it leniently and drops what does not fit.
    const workspaceContext = { view: "anything", extra: [1, 2, 3] };
    const response = await post({ ...turn, workspaceContext });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sessionId: "session-1",
      actionNonce: "abcdefghij",
    });
    expect(mocks.start).toHaveBeenCalledWith({
      workspaceId,
      userId,
      chatId,
      prompt: "/plan Add caching",
      provider: "claude",
      idempotencyKey: "turn-12345678",
      worktreeId: undefined,
      model: undefined,
      acknowledgedDuplicateOf: undefined,
      workspaceContext,
    });
  });

  it("returns a goal change without a session", async () => {
    mocks.start.mockResolvedValue({ goal: null });
    const response = await post({ ...turn, prompt: "/goal clear" });
    expect(await response.json()).toEqual({ goal: null });
  });

  it("refuses a turn from another origin before starting it", async () => {
    const response = await post(turn, "https://evil.test");
    expect(response.status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
