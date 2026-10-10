import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  connection: vi.fn(),
  request: vi.fn(),
}));

vi.mock("./workspaces", () => ({ requireGen2Member: mocks.member }));
vi.mock("../github/github", async () => {
  class GitHubApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    GitHubApiError,
    githubRequest: mocks.request,
    resolveGithubConnection: mocks.connection,
  };
});

import { GitHubApiError } from "../github/github";
import { listGen2RemoteBranches } from "./remote-branches";

const repository = {
  fullName: "acme/app",
  private: true,
  defaultBranch: "main",
};
const names = (count: number, prefix = "b") =>
  Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index}` }));

describe("listGen2RemoteBranches", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.member.mockResolvedValue({ repository });
    mocks.connection.mockResolvedValue({ connected: true, login: "ada" });
  });

  it("lists every branch with the caller's GitHub access, default first", async () => {
    mocks.request.mockResolvedValue([
      { name: "zeta" },
      { name: "main" },
      { name: "Alpha" },
    ]);
    const list = await listGen2RemoteBranches("ws-1", "user-1");

    expect(mocks.member).toHaveBeenCalledWith("ws-1", "user-1");
    expect(mocks.request).toHaveBeenCalledWith(
      "user-1",
      "/repos/acme/app/branches?per_page=100&page=1",
    );
    expect(list).toEqual({
      branches: [{ name: "main" }, { name: "Alpha" }, { name: "zeta" }],
      defaultBranch: "main",
      truncated: false,
      unavailable: null,
    });
  });

  it("pages through large repositories and stops at 300 branches", async () => {
    mocks.request
      .mockResolvedValueOnce(names(100, "a"))
      .mockResolvedValueOnce(names(100, "b"))
      .mockResolvedValueOnce(names(100, "c"));
    const list = await listGen2RemoteBranches("ws-1", "user-1");

    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(list.branches).toHaveLength(300);
    expect(list.truncated).toBe(true);
  });

  it("explains why branches are unavailable instead of failing", async () => {
    mocks.member.mockResolvedValueOnce({ repository: null });
    expect((await listGen2RemoteBranches("ws-1", "u")).unavailable).toBe(
      "no-repository",
    );

    mocks.connection.mockResolvedValueOnce({ connected: false, login: null });
    expect((await listGen2RemoteBranches("ws-1", "u")).unavailable).toBe(
      "github-not-connected",
    );

    mocks.request.mockRejectedValueOnce(new GitHubApiError("Not Found", 404));
    expect((await listGen2RemoteBranches("ws-1", "u")).unavailable).toBe(
      "github-no-access",
    );
  });

  it("surfaces unexpected GitHub failures", async () => {
    mocks.request.mockRejectedValue(new GitHubApiError("boom", 500));
    await expect(listGen2RemoteBranches("ws-1", "u")).rejects.toThrow("boom");
  });
});
