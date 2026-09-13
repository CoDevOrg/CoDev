import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./database", () => ({ getDatabase: vi.fn() }));
vi.mock("./settings-access", () => ({
  requireOrganizationSettingsWrite: vi.fn(),
}));
vi.mock("./orchestrator", () => ({
  destroySandbox: vi.fn(),
  discardSandboxSnapshot: vi.fn(),
  ensureHostReady: vi.fn(),
  provisionSandbox: vi.fn(),
  getSandbox: vi.fn(),
  snapshotWorkspace: vi.fn(),
  resumeSandbox: vi.fn(),
  pollClaudeSetupTokenInSandbox: vi.fn(),
  startClaudeSetupTokenInSandbox: vi.fn(),
  submitClaudeSetupTokenCodeInSandbox: vi.fn(),
}));
import {
  isClaudeRunnerDisposableHere,
  orchestratorClaudeRunner,
  resolveClaudeRunner,
  subprocessClaudeRunner,
} from "./claude-connection-runner";
import {
  decodeClaudeRuntimeReference,
  encodeClaudeRuntimeReference,
} from "./claude-runtime-reference";
import {
  claudeLoginEnvironment,
  claudeProfilePath,
} from "./claude-subprocess-login";
import * as runtime from "./orchestrator";
const profileId = "11111111-1111-4111-8111-111111111111";
const runnerId = encodeClaudeRuntimeReference({
  version: 1,
  backend: "orchestrator",
  profileId,
  sessionId: "claude-1-1",
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runtime.destroySandbox).mockResolvedValue(undefined);
  vi.mocked(runtime.discardSandboxSnapshot).mockResolvedValue(undefined);
  vi.mocked(runtime.startClaudeSetupTokenInSandbox).mockResolvedValue({
    sessionId: "claude-1-1",
    authorizeUrl: "https://claude.ai/oauth/authorize?client_id=abc",
  });
  vi.mocked(runtime.getSandbox).mockResolvedValue({
    status: "ready",
    headSha: "a".repeat(40),
  } as never);
});
afterEach(() => vi.unstubAllEnvs());
describe("official Claude runtime references", () => {
  it("validates references and refuses legacy tokens or arbitrary paths", () => {
    expect(decodeClaudeRuntimeReference(runnerId)).toMatchObject({ profileId });
    for (const invalid of [
      "sk-ant-oat01-secret",
      "old:claude-1-1",
      'claude-login-v1:{"version":1,"backend":"subprocess","profileId":"../../home"}',
    ])
      expect(() => decodeClaudeRuntimeReference(invalid)).toThrow();
    expect(() => claudeProfilePath("../other-user")).toThrow();
  });
  it("dispatches using the stored backend, not today's environment", () => {
    vi.stubEnv("CLAUDE_CONNECTION_RUNNER", "subprocess");
    expect(resolveClaudeRunner(runnerId)).toBe(orchestratorClaudeRunner);
    vi.stubEnv("VERCEL", "");
    expect(resolveClaudeRunner()).toBe(subprocessClaudeRunner);
    vi.stubEnv("VERCEL", "1");
    expect(() => resolveClaudeRunner()).toThrow(/persistent local runtime/);
  });
  it("treats a subprocess profile as disposable only off Vercel", () => {
    const subprocessRunnerId = encodeClaudeRuntimeReference({
      version: 1,
      backend: "subprocess",
      profileId,
    });
    vi.stubEnv("VERCEL", "");
    expect(isClaudeRunnerDisposableHere(subprocessRunnerId)).toBe(true);
    vi.stubEnv("VERCEL", "1");
    // A local profile is unreachable from Vercel; disconnect must clear the row
    // rather than resolve a runner that would throw.
    expect(isClaudeRunnerDisposableHere(subprocessRunnerId)).toBe(false);
    // Orchestrator references are always disposable; legacy tokens never are.
    expect(isClaudeRunnerDisposableHere(runnerId)).toBe(true);
    expect(isClaudeRunnerDisposableHere("sk-ant-oat01-secret")).toBe(false);
  });
  it("does not inherit provider credentials or endpoint overrides", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "secret");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "secret");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://untrusted.invalid");
    const env = claudeLoginEnvironment(claudeProfilePath(profileId));
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(env).not.toHaveProperty("ANTHROPIC_BASE_URL");
    expect(env.CLAUDE_CONFIG_DIR).toContain(profileId);
  });
});
describe("hosted official login", () => {
  it("snapshots the private runtime before releasing capacity and retains only a reference", async () => {
    const started = await orchestratorClaudeRunner.start({
      sessionId: profileId,
    });
    expect(started.runnerId).toBe(runnerId);
    expect(runtime.provisionSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: profileId,
        ephemeral: true,
        repositoryUrl: null,
      }),
    );
    vi.mocked(runtime.pollClaudeSetupTokenInSandbox).mockResolvedValue({
      status: "ready",
    });
    await expect(orchestratorClaudeRunner.poll({ runnerId })).resolves.toEqual({
      status: "ready",
    });
    await orchestratorClaudeRunner.retain?.({ runnerId });
    expect(runtime.snapshotWorkspace).toHaveBeenCalledWith(
      profileId,
      "a".repeat(40),
    );
    expect(runtime.destroySandbox).toHaveBeenCalledWith(profileId);
    expect(runtime.discardSandboxSnapshot).not.toHaveBeenCalled();
    await orchestratorClaudeRunner.dispose({ runnerId });
    expect(runtime.discardSandboxSnapshot).toHaveBeenCalledWith(profileId);
  });
  it("cleans up and fails closed when the guest lacks the new protocol", async () => {
    vi.mocked(runtime.startClaudeSetupTokenInSandbox).mockRejectedValueOnce(
      new Error("404"),
    );
    await expect(
      orchestratorClaudeRunner.start({ sessionId: profileId }),
    ).rejects.toThrow(/runtime-login protocol/);
    expect(runtime.destroySandbox).toHaveBeenCalledWith(profileId);
    expect(runtime.discardSandboxSnapshot).toHaveBeenCalledWith(profileId);
  });
  it("does not acknowledge a profile snapshot failure", async () => {
    vi.mocked(runtime.snapshotWorkspace).mockRejectedValueOnce(
      new Error("disk failure"),
    );
    await expect(
      orchestratorClaudeRunner.retain?.({ runnerId }),
    ).rejects.toThrow("disk failure");
    expect(runtime.destroySandbox).not.toHaveBeenCalled();
  });
});
