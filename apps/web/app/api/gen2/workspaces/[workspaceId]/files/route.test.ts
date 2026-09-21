import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  search: vi.fn(),
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
vi.mock("@/lib/gen2/workbench", () => ({
  listGen2Files: mocks.list,
  readGen2File: mocks.read,
  writeGen2File: mocks.write,
  searchGen2Files: mocks.search,
}));

import { GET, POST, PUT, maxDuration } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/files`;

function put(body: unknown) {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("gen2 files route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("outlasts the guest's own 30s find/grep timeout", () => {
    expect(maxDuration).toBe(60);
  });

  it("requires a signed-in caller", async () => {
    mocks.getApiUser.mockResolvedValue(null);
    const response = await GET(new Request(url), { params });
    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("lists the machine's files", async () => {
    mocks.list.mockResolvedValue([{ path: "a.ts", status: "M" }]);
    const response = await GET(new Request(url), { params });
    expect(await response.json()).toEqual({
      files: [{ path: "a.ts", status: "M" }],
    });
  });

  it("searches when a query is supplied", async () => {
    mocks.search.mockResolvedValue([
      { path: "a.ts", line: 2, preview: "todo" },
    ]);
    const response = await GET(new Request(`${url}?query=todo`), { params });
    expect(mocks.search).toHaveBeenCalledWith(workspaceId, userId, "todo");
    expect(await response.json()).toMatchObject({ matches: [{ line: 2 }] });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("reads a file", async () => {
    mocks.read.mockResolvedValue({
      path: "a.ts",
      contents: "x",
      revision: "r",
    });
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "a.ts" }),
      }),
      { params },
    );
    expect(await response.json()).toEqual({
      file: { path: "a.ts", contents: "x", revision: "r" },
    });
  });

  it("rejects a malformed write before it reaches the guest", async () => {
    const response = await PUT(put({ path: "a.ts", contents: "x" }), {
      params,
    });
    expect(response.status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("passes the expected revision through so a stale save is caught", async () => {
    mocks.write.mockResolvedValue({ revision: "r2" });
    const response = await PUT(
      put({ path: "a.ts", contents: "x", expectedRevision: "r1" }),
      { params },
    );
    expect(mocks.write).toHaveBeenCalledWith(workspaceId, userId, {
      path: "a.ts",
      contents: "x",
      expectedRevision: "r1",
    });
    expect(await response.json()).toEqual({ revision: "r2" });
  });

  it("returns the conflict body the editor needs to recover", async () => {
    const { Gen2FileConflictError } = await import("@/lib/gen2/errors");
    mocks.write.mockRejectedValue(new Gen2FileConflictError("a.ts", "r9"));
    const response = await PUT(
      put({ path: "a.ts", contents: "x", expectedRevision: "r1" }),
      { params },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "revision_mismatch",
      currentRevision: "r9",
      path: "a.ts",
    });
  });
});
