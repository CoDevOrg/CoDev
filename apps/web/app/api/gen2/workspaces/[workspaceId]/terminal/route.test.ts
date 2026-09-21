import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  start: vi.fn(),
  input: vi.fn(),
  resize: vi.fn(),
  poll: vi.fn(),
  close: vi.fn(),
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
vi.mock("@/lib/gen2/terminals", () => ({
  startGen2Terminal: mocks.start,
  sendGen2TerminalInput: mocks.input,
  resizeGen2Terminal: mocks.resize,
  pollGen2Terminal: mocks.poll,
  closeGen2Terminal: mocks.close,
}));

import { DELETE, POST, maxDuration } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/terminal`;

function post(body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("gen2 terminal route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("outlives a poll that parks for 20s in the guest", () => {
    expect(maxDuration).toBe(60);
  });

  it("opens a session", async () => {
    mocks.start.mockResolvedValue("term-1-2");
    const response = await POST(
      post({ action: "start", rows: 24, columns: 80 }),
      { params },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ sessionId: "term-1-2" });
  });

  it("refuses a viewport the guest would reject anyway", async () => {
    const response = await POST(
      post({ action: "start", rows: 24, columns: 501 }),
      { params },
    );
    expect(response.status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("refuses a session id that is not one the guest minted", async () => {
    const response = await POST(
      post({ action: "input", sessionId: "../etc", data: "ls" }),
      { params },
    );
    expect(response.status).toBe(400);
    expect(mocks.input).not.toHaveBeenCalled();
  });

  it("forwards input and resize without a body", async () => {
    const input = await POST(
      post({ action: "input", sessionId: "term-1-2", data: "ls\n" }),
      { params },
    );
    expect(input.status).toBe(204);
    expect(mocks.input).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "term-1-2",
      "ls\n",
    );

    const resize = await POST(
      post({ action: "resize", sessionId: "term-1-2", rows: 30, columns: 100 }),
      { params },
    );
    expect(resize.status).toBe(204);
  });

  it("returns a poll result unchanged", async () => {
    const result = {
      chunks: [{ sequence: 1, data: "hi" }],
      nextSequence: 2,
      exited: false,
      exitCode: null,
    };
    mocks.poll.mockResolvedValue(result);
    const response = await POST(
      post({ action: "poll", sessionId: "term-1-2", after: 1 }),
      { params },
    );
    expect(await response.json()).toEqual(result);
  });

  it("closes a session named in the query string", async () => {
    const response = await DELETE(
      new Request(`${url}?sessionId=term-1-2`, { method: "DELETE" }),
      { params },
    );
    expect(response.status).toBe(204);
    expect(mocks.close).toHaveBeenCalledWith(workspaceId, userId, "term-1-2");
  });
});
