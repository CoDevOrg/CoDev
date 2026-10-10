import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiUser: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/http/api", () => ({
  apiError: (error: unknown, status = 400) =>
    Response.json(
      { error: error instanceof Error ? error.message : "request failed" },
      { status },
    ),
  getApiUser: mocks.getApiUser,
  getApiUserAnyAuth: mocks.getApiUser,
}));
vi.mock("@/lib/gen2/workspace-ports", () => ({
  listGen2WorkspacePorts: mocks.list,
}));

import { Gen2AccessError } from "@/lib/gen2/errors";
import { GET } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const params = Promise.resolve({ workspaceId });
const request = () =>
  new Request(
    `https://codev.test/api/gen2/workspaces/${workspaceId}/preview/ports`,
  );

describe("preview ports route", () => {
  beforeEach(() => mocks.getApiUser.mockResolvedValue({ id: "user-1" }));
  afterEach(() => vi.resetAllMocks());

  it("lists the member's previewable ports without caching", async () => {
    const ports = {
      available: true,
      reason: null,
      ports: [{ port: 3000, address: "any" }],
    };
    mocks.list.mockResolvedValue(ports);
    const response = await GET(request(), { params });
    expect(await response.json()).toEqual(ports);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.list).toHaveBeenCalledWith(workspaceId, "user-1");
  });

  it("rejects signed-out callers and viewers", async () => {
    mocks.getApiUser.mockResolvedValueOnce(null);
    expect((await GET(request(), { params })).status).toBe(401);
    mocks.list.mockRejectedValueOnce(
      new Gen2AccessError("Only editors can open previews.", 403),
    );
    expect((await GET(request(), { params })).status).toBe(403);
  });
});
