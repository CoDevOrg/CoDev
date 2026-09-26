import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  create: vi.fn(),
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
  createGen2SupersetEntry: mocks.create,
}));

import { POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/superset/entry`;

function post(body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Superset entry route", () => {
  beforeEach(() => mocks.getApiUser.mockResolvedValue({ id: userId }));
  afterEach(() => vi.resetAllMocks());

  it("creates a root-level file through the authenticated bridge", async () => {
    mocks.create.mockResolvedValue({
      path: "notes.md",
      kind: "file",
      size: 0,
    });
    const input = { worktreeId: "main", name: "notes.md", kind: "file" };
    const response = await POST(post(input), { params });
    expect(mocks.create).toHaveBeenCalledWith(workspaceId, userId, input);
    expect(await response.json()).toEqual({
      entry: { path: "notes.md", kind: "file", size: 0 },
    });
  });

  it("rejects a path instead of a single entry name", async () => {
    const response = await POST(
      post({ worktreeId: "main", name: "src/notes.md", kind: "file" }),
      { params },
    );
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
