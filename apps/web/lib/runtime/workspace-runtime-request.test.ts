import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  target: vi.fn(),
  token: vi.fn(),
  activity: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("./workspace-runtime-target", () => ({
  workspaceRuntimeTarget: mocks.target,
}));
vi.mock("./arm-workspace-provider", () => ({ capabilityToken: mocks.token }));
vi.mock("./arm-workspace-member-activity", () => ({
  recordArmWorkspaceMemberActivity: mocks.activity,
}));
vi.mock("@codev/config", () => ({
  readServerEnvironment: () => ({
    ORCHESTRATOR_DIRECT_URL: "https://firecracker.test",
    ORCHESTRATOR_DIRECT_SECRET: "legacy",
  }),
}));
import {
  readSandboxFile,
  writeSandboxFile,
  executeInSandbox,
  getSandboxGitOutput,
} from "./orchestrator-files";
import { pollSandboxTerminal } from "./orchestrator-terminals";
import { pollCodexExecInSandbox } from "./orchestrator-codex-exec";
import { getSupersetGitOutput } from "./orchestrator-superset-runtime";
import { orchestratorRequest, OrchestratorError } from "./orchestrator-request";

const target = {
  workspaceId: "workspace-a",
  host: "codev-arm.trycodev.com",
  generation: 4,
};
describe("provider-aware workspace transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.target.mockResolvedValue(target);
    mocks.token.mockResolvedValue("signed-capability");
    mocks.activity.mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue(Response.json({}));
  });
  it("routes revision-checked reads and saves to the ARM guest with the exact signed body", async () => {
    const file = { path: "src/main.ts", contents: "saved", revision: "r1" };
    mocks.fetch.mockResolvedValueOnce(Response.json(file));
    expect(await readSandboxFile(target.workspaceId, file.path)).toEqual(file);
    const input = {
      path: file.path,
      contents: "edited",
      expectedRevision: "r1",
    };
    mocks.fetch.mockResolvedValueOnce(Response.json({ revision: "r2" }));
    expect(await writeSandboxFile(target.workspaceId, input)).toEqual({
      revision: "r2",
    });
    expect(mocks.fetch.mock.lastCall?.[0]).toBe(
      `https://${target.host}/v1/files/write`,
    );
    const init = mocks.fetch.mock.lastCall?.[1] as RequestInit;
    expect(mocks.token).toHaveBeenLastCalledWith(
      target.host,
      target.workspaceId,
      4,
      {
        method: "POST",
        path: "/v1/files/write",
        scope: "workspace",
        body: init.body,
      },
    );
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      authorization: "Bearer signed-capability",
    });
  });
  it("keeps terminal and agent poll wire shapes and transcript chunks", async () => {
    const terminal = {
      chunks: [{ sequence: 1, data: "hello" }],
      nextSequence: 2,
      exited: false,
      exitCode: null,
    };
    mocks.fetch.mockResolvedValueOnce(Response.json(terminal));
    expect(
      await pollSandboxTerminal(target.workspaceId, "terminal-a", 0),
    ).toEqual(terminal);
    const agent = {
      ...terminal,
      chunks: [{ sequence: 1, dataBase64: "aGVsbG8=" }],
    };
    mocks.fetch.mockResolvedValueOnce(Response.json(agent));
    expect(
      await pollCodexExecInSandbox(target.workspaceId, "agent-a", 0),
    ).toEqual(agent);
    expect(mocks.fetch.mock.lastCall?.[0]).toBe(
      `https://${target.host}/v1/codex-execs/agent-a/poll`,
    );
  });
  it("routes command execution, Git worktrees and Superset through the same guest", async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ output: "hello", exitCode: 0 }),
    );
    expect(
      await executeInSandbox(target.workspaceId, { command: ["pwd"] }),
    ).toEqual({ output: "hello", exitCode: 0 });
    mocks.fetch.mockResolvedValueOnce(Response.json({ output: "diff" }));
    expect(
      await getSandboxGitOutput(target.workspaceId, "diff", "branch-a"),
    ).toBe("diff");
    expect(mocks.fetch.mock.lastCall?.[0]).toContain(
      "/v1/git/diff?worktreeId=branch-a",
    );
    mocks.fetch.mockResolvedValueOnce(Response.json({ output: "status" }));
    expect(
      await getSupersetGitOutput(target.workspaceId, "branch-a", "status"),
    ).toBe("status");
    expect(mocks.fetch.mock.lastCall?.[0]).toContain(
      "/v1/superset/runtime/git",
    );
  });
  it("preserves conflict errors instead of wrapping an ARM error as success", async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json(
        { error: "revision mismatch", currentRevision: "r3" },
        { status: 409 },
      ),
    );
    await expect(
      writeSandboxFile(target.workspaceId, {
        path: "a",
        contents: "b",
        expectedRevision: "r1",
      }),
    ).rejects.toMatchObject({ status: 409, currentRevision: "r3" });
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("retains Firecracker routing and never falls back after an ARM target failure", async () => {
    mocks.target.mockResolvedValueOnce(null);
    await orchestratorRequest("GET", "/v1/sandboxes/workspace-a/git/status");
    expect(mocks.fetch.mock.lastCall?.[0]).toBe(
      "https://firecracker.test/v1/sandboxes/workspace-a/git/status",
    );
    mocks.fetch.mockClear();
    mocks.target.mockRejectedValueOnce(
      new OrchestratorError("not running", 409),
    );
    await expect(
      orchestratorRequest("GET", "/v1/sandboxes/workspace-a/git/status"),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
