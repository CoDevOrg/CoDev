import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  installations: vi.fn(),
  repositories: vi.fn(),
}));
vi.mock("./github", async (original) => ({
  ...(await original<typeof import("./github")>()),
  githubRequest: mocks.request,
  listGitHubInstallations: mocks.installations,
  listRepositories: mocks.repositories,
}));
import { GitHubApiError } from "./github";
import {
  listPickerAccounts,
  listPickerRepositories,
} from "./repository-picker";

const installations = [
  { id: 10, account: { login: "friend", type: "User" } },
  { id: 20, account: { login: "ada", type: "User" } },
  { id: 30, account: { login: "team", type: "Organization" } },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.installations.mockResolvedValue(installations);
  mocks.request.mockImplementation(async (_user, path) =>
    path === "/user"
      ? { login: "Ada", avatar_url: "" }
      : [{ login: "Ada" }, { login: "friend" }, { login: "grace" }],
  );
  mocks.repositories.mockImplementation(async (_user, id) => [
    {
      id,
      full_name: `${id === 10 ? "friend" : "ada"}/project`,
      owner: { login: id === 10 ? "friend" : "ada" },
      private: true,
      default_branch: "main",
    },
  ]);
});

describe("GitHub repository picker", () => {
  it("puts the authenticated account first and hides other personal accounts", async () => {
    const accounts = await listPickerAccounts("member");
    expect(accounts.map((account) => account.account.login)).toEqual([
      "Ada",
      "team",
    ]);
    expect(accounts[0]?.id).toBe(20);
  });
  it("keeps shared projects under the member with their real installation and collaborators", async () => {
    const repos = await listPickerRepositories("member", 20);
    expect(repos).toHaveLength(2);
    expect(repos.find((repo) => repo.id === 10)).toMatchObject({
      full_name: "friend/project",
      installationId: 10,
      sharedWith: ["friend", "grace"],
    });
    expect(mocks.repositories).not.toHaveBeenCalledWith("member", 30);
  });
  it("keeps shared repositories available when member listing is forbidden", async () => {
    mocks.request.mockImplementation(async (_user, path) => {
      if (path === "/user") return { login: "ada", avatar_url: "" };
      throw new GitHubApiError("Forbidden", 403);
    });
    expect((await listPickerRepositories("member", 20))[0]?.sharedWith).toEqual(
      ["friend"],
    );
  });
  it("offers shared projects even without an installation on the member's own account", async () => {
    mocks.installations.mockResolvedValue([installations[0]]);
    expect((await listPickerAccounts("member"))[0]?.id).toBe(0);
    expect((await listPickerRepositories("member", 0))[0]?.installationId).toBe(
      10,
    );
  });
  it("rejects hidden personal accounts and unknown installations as account choices", async () => {
    await expect(listPickerRepositories("member", 10)).rejects.toThrow(
      "Invalid GitHub account",
    );
    await expect(listPickerRepositories("member", 999)).rejects.toThrow(
      "Invalid GitHub account",
    );
  });
});
