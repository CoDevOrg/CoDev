import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  git: vi.fn(),
  show: vi.fn(),
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
  getGen2Git: mocks.git,
  showGen2HeadFile: mocks.show,
}));

import { GET } from "./route";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const userId = "2f2387ed-4a63-4b05-88cc-266d65f7b82b";
const params = Promise.resolve({ workspaceId });
const url = `https://codev.test/api/gen2/workspaces/${workspaceId}/git`;

describe("gen2 git route", () => {
  beforeEach(() => {
    mocks.getApiUser.mockResolvedValue({ id: userId });
  });
  afterEach(() => vi.resetAllMocks());

  it("returns porcelain status", async () => {
    mocks.git.mockResolvedValue("## main\n M a.ts\n");
    const response = await GET(new Request(`${url}?operation=status`), {
      params,
    });
    expect(mocks.git).toHaveBeenCalledWith(workspaceId, userId, "status");
    expect(await response.json()).toEqual({ output: "## main\n M a.ts\n" });
  });

  it("rejects an operation it does not serve", async () => {
    const response = await GET(new Request(`${url}?operation=push`), {
      params,
    });
    expect(response.status).toBe(400);
    expect(mocks.git).not.toHaveBeenCalled();
  });

  it("reads a file at HEAD and says when there isn't one", async () => {
    mocks.show.mockResolvedValue({ contents: "", exists: false });
    const response = await GET(
      new Request(`${url}?operation=show&path=new.ts`),
      { params },
    );
    expect(await response.json()).toEqual({ contents: "", exists: false });
  });

  it("requires a path for show", async () => {
    const response = await GET(new Request(`${url}?operation=show`), {
      params,
    });
    expect(response.status).toBe(400);
    expect(mocks.show).not.toHaveBeenCalled();
  });
});
