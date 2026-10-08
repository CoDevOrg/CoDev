import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  create: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
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
  moveGen2SupersetEntry: mocks.move,
  deleteGen2SupersetEntry: mocks.remove,
}));

import { DELETE, PATCH, POST } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/superset/entry`;

function post(body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: {
      origin: "https://codev.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function request(method: "PATCH" | "DELETE", body: unknown) {
  return new Request(url, {
    method,
    headers: {
      origin: "https://codev.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Superset entry route", () => {
  beforeEach(() => mocks.getApiUser.mockResolvedValue({ id: userId }));
  afterEach(() => vi.resetAllMocks());

  it("creates a file in the selected folder through the authenticated bridge", async () => {
    mocks.create.mockResolvedValue({
      path: "notes.md",
      kind: "file",
      size: 0,
    });
    const input = {
      worktreeId: "main",
      parentPath: "notes",
      name: "notes.md",
      kind: "file",
    };
    const response = await POST(post(input), { params });
    expect(mocks.create).toHaveBeenCalledWith(workspaceId, userId, input);
    expect(await response.json()).toEqual({
      entry: { path: "notes.md", kind: "file", size: 0 },
    });
  });

  it("keeps root-level creation compatible when no parent path is sent", async () => {
    mocks.create.mockResolvedValue({ path: "notes.md", kind: "file", size: 0 });

    const response = await POST(
      post({ worktreeId: "main", name: "notes.md", kind: "file" }),
      { params },
    );

    expect(mocks.create).toHaveBeenCalledWith(workspaceId, userId, {
      worktreeId: "main",
      parentPath: "",
      name: "notes.md",
      kind: "file",
    });
    expect(response.status).toBe(200);
  });

  it("renames an entry through the authenticated bridge", async () => {
    const input = {
      worktreeId: "main",
      path: "notes/draft.md",
      parentPath: "notes",
      name: "published.md",
    };
    mocks.move.mockResolvedValue({
      path: "notes/published.md",
      kind: "file",
      size: 12,
    });

    const response = await PATCH(request("PATCH", input), { params });

    expect(mocks.move).toHaveBeenCalledWith(workspaceId, userId, input);
    expect(await response.json()).toEqual({
      entry: { path: "notes/published.md", kind: "file", size: 12 },
    });
  });

  it("deletes an entry through the authenticated bridge", async () => {
    const input = { worktreeId: "main", path: "notes/archive" };
    mocks.remove.mockResolvedValue(input.path);

    const response = await DELETE(request("DELETE", input), { params });

    expect(mocks.remove).toHaveBeenCalledWith(workspaceId, userId, input);
    expect(await response.json()).toEqual({ path: input.path });
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
