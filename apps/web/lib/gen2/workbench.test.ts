import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(),
  exec: vi.fn(),
  git: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("./workspaces", () => ({
  requireGen2Member: (...args: unknown[]) => mocks.requireMember(...args),
}));

vi.mock("../runtime/orchestrator-files", () => ({
  executeInSandbox: (...args: unknown[]) => mocks.exec(...args),
  getSandboxGitOutput: (...args: unknown[]) => mocks.git(...args),
  readSandboxFile: (...args: unknown[]) => mocks.read(...args),
  writeSandboxFile: (...args: unknown[]) => mocks.write(...args),
}));

const { OrchestratorError } = await import("../runtime/orchestrator-request");
const { Gen2FileConflictError } = await import("./errors");
const {
  getGen2Git,
  listGen2Files,
  readGen2File,
  searchGen2Files,
  showGen2HeadFile,
  writeGen2File,
} = await import("./workbench");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

describe("gen2 workbench", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireMember.mockResolvedValue({
      id: workspaceId,
      status: "ready",
      role: "owner",
    });
    mocks.exec.mockResolvedValue({ output: "", exitCode: 0 });
    mocks.git.mockResolvedValue("");
  });

  it("checks membership before it reaches the orchestrator", async () => {
    // lib/runtime/orchestrator-* performs no authorization of its own, so
    // this ordering is the only thing standing between a signed-in stranger
    // and every Gen 2 workspace.
    mocks.requireMember.mockRejectedValue(new Error("not a member"));
    await expect(listGen2Files(workspaceId, userId)).rejects.toThrow(
      "not a member",
    );
    await expect(readGen2File(workspaceId, userId, "a.ts")).rejects.toThrow(
      "not a member",
    );
    await expect(getGen2Git(workspaceId, userId, "status")).rejects.toThrow(
      "not a member",
    );
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.git).not.toHaveBeenCalled();
  });

  it("refuses the exec-backed surfaces until the instance is running", async () => {
    mocks.requireMember.mockResolvedValue({
      id: workspaceId,
      status: "stopped",
      role: "owner",
    });
    await expect(listGen2Files(workspaceId, userId)).rejects.toThrow(
      /Start the instance/,
    );
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("keeps reading files and git available without a ready gate", async () => {
    // Neither read_file nor git/* takes the guest mutation lock, so both keep
    // answering while a Codex turn holds it.
    mocks.requireMember.mockResolvedValue({
      id: workspaceId,
      status: "provisioning",
      role: "member",
    });
    mocks.read.mockResolvedValue({ path: "a.ts", contents: "", revision: "r" });
    await expect(readGen2File(workspaceId, userId, "a.ts")).resolves.toEqual({
      path: "a.ts",
      contents: "",
      revision: "r",
    });
    await expect(getGen2Git(workspaceId, userId, "diff")).resolves.toBe("");
  });

  it("merges git status into the file list", async () => {
    mocks.exec.mockResolvedValue({
      output: "./README.md\n./src/a.ts\n",
      exitCode: 0,
    });
    mocks.git.mockResolvedValue("## main\n M src/a.ts\n");
    await expect(listGen2Files(workspaceId, userId)).resolves.toEqual([
      { path: "README.md", status: null },
      { path: "src/a.ts", status: "M" },
    ]);
  });

  it("searches untracked files too", async () => {
    // Without --untracked, a file the agent just created is unfindable.
    mocks.exec.mockResolvedValue({ output: "", exitCode: 1 });
    await expect(searchGen2Files(workspaceId, userId, "todo")).resolves.toEqual(
      [],
    );
    expect(mocks.exec.mock.calls[0]?.[1].command).toContain("--untracked");
  });

  it("turns a stale write into a conflict carrying the current revision", async () => {
    mocks.write.mockRejectedValue(
      new OrchestratorError(
        "revision mismatch: current revision is abc123",
        409,
      ),
    );
    const failure = await writeGen2File(workspaceId, userId, {
      path: "a.ts",
      contents: "x",
      expectedRevision: "stale",
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Gen2FileConflictError);
    expect(failure).toMatchObject({
      path: "a.ts",
      currentRevision: "abc123",
      status: 409,
    });
  });

  it("reports a file that is not in HEAD rather than an empty one", async () => {
    mocks.exec.mockResolvedValue({ output: "", exitCode: 128 });
    await expect(
      showGen2HeadFile(workspaceId, userId, "new.ts"),
    ).resolves.toEqual({ contents: "", exists: false });
  });
});
