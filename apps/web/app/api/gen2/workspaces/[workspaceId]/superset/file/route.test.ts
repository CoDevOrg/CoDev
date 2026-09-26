import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
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
vi.mock("@/lib/gen2/superset", () => ({
  readGen2SupersetFile: mocks.read,
  saveGen2SupersetFile: mocks.save,
}));

import { GET, PUT } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/superset/file`;

function put(body: unknown) {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Superset file route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("reads a selected file", async () => {
    mocks.read.mockResolvedValue({
      path: "src/greeting.ts",
      kind: "file",
      size: 15,
      contents: "export {};",
      revision: "rev-1",
    });
    const response = await GET(
      new Request(`${url}?worktreeId=main&path=src%2Fgreeting.ts`),
      { params },
    );
    expect(mocks.read).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "main",
      "src/greeting.ts",
    );
    expect(await response.json()).toMatchObject({
      file: { revision: "rev-1" },
    });
  });

  it("validates a revision-checked save before forwarding it", async () => {
    const response = await PUT(
      put({
        worktreeId: "main",
        path: "src/greeting.ts",
        contents: "export {};",
      }),
      { params },
    );
    expect(response.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("sends the expected revision to Superset", async () => {
    const input = {
      worktreeId: "main",
      path: "src/greeting.ts",
      contents: "export {};",
      expectedRevision: "rev-1",
    };
    mocks.save.mockResolvedValue({
      ...input,
      kind: "file",
      size: input.contents.length,
      revision: "rev-2",
    });
    const response = await PUT(put(input), { params });
    expect(mocks.save).toHaveBeenCalledWith(workspaceId, userId, input);
    expect(await response.json()).toMatchObject({
      file: { revision: "rev-2" },
    });
  });
});
