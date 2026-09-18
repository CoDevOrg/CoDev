import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  auth: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  exit: undefined as undefined | ((code: number) => void),
  data: undefined as undefined | ((data: string) => void),
  write: vi.fn(),
  kill: vi.fn(),
  output: "",
}));
vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({
  default: { existsSync: () => true },
  existsSync: () => true,
}));
vi.mock("node:fs/promises", () => ({
  default: { mkdir: mocks.mkdir, rm: mocks.rm },
  mkdir: mocks.mkdir,
  rm: mocks.rm,
}));
vi.mock("node:util", () => ({
  default: { promisify: () => mocks.auth },
  promisify: () => mocks.auth,
}));
vi.mock("node:child_process", () => ({
  default: { execFile: vi.fn(), spawn: mocks.spawn },
  execFile: vi.fn(),
  spawn: mocks.spawn,
}));
vi.mock("node-pty", () => ({
  default: { spawn: mocks.spawn },
  spawn: mocks.spawn,
}));
import { subprocessClaudeRunner } from "./claude-subprocess-login";
import { encodeClaudeRuntimeReference } from "./claude-runtime-reference";
const profileId = "22222222-2222-4222-8222-222222222222";
const runnerId = encodeClaudeRuntimeReference({
  version: 1,
  backend: "subprocess",
  profileId,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.output = "https://claude.ai/oauth/authorize?state=test\n";
  mocks.auth.mockResolvedValue({
    stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }),
  });
  mocks.kill.mockImplementation(() => mocks.exit?.(1));
  mocks.spawn.mockImplementation(() => {
    const onData = (callback: (data: string) => void) => {
      mocks.data = callback;
      callback(mocks.output);
    };
    return {
      write: mocks.write,
      kill: mocks.kill,
      onData,
      onExit: (callback: (event: { exitCode: number }) => void) => {
        mocks.exit = (exitCode) => callback({ exitCode });
      },
      stdin: { write: mocks.write },
      stdout: {
        on: (_event: string, callback: (data: string) => void) =>
          onData(callback),
      },
      stderr: { on: vi.fn() },
      on: (event: string, callback: (code: number) => void) => {
        if (event === "close") mocks.exit = callback;
      },
    };
  });
});
afterEach(async () => {
  await subprocessClaudeRunner.dispose({ runnerId });
});
describe("isolated official subprocess login", () => {
  it("uses the full hyperlink, never its truncated visible label", async () => {
    const url =
      "https://claude.com/cai/oauth/authorize?client_id=full&state=complete";
    mocks.output = `\x1b]8;;${url}\x07https://claude.com/cai/oauth/authorize?client_id=fu\x1b]8;;\x07`;
    await expect(
      subprocessClaudeRunner.start({ sessionId: profileId }),
    ).resolves.toMatchObject({ authorizeUrl: url });
  });
  it("runs auth login and verifies auth status without reading credential files", async () => {
    const started = await subprocessClaudeRunner.start({
      sessionId: profileId,
    });
    expect(started.runnerId).toBe(runnerId);
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      ["auth", "login", "--claudeai"],
      expect.objectContaining({ cwd: expect.stringContaining(profileId) }),
    );
    await subprocessClaudeRunner.submitCode({ runnerId, code: "code#state" });
    await expect(subprocessClaudeRunner.poll({ runnerId })).resolves.toEqual({
      status: "pending",
    });
    mocks.exit?.(0);
    await expect(subprocessClaudeRunner.poll({ runnerId })).resolves.toEqual({
      status: "ready",
    });
    expect(mocks.auth).toHaveBeenCalledWith(
      expect.any(String),
      ["auth", "status"],
      expect.any(Object),
    );
    expect(mocks.rm).not.toHaveBeenCalled();
    // No live process is required once the runtime profile is signed in.
    await expect(subprocessClaudeRunner.poll({ runnerId })).resolves.toEqual({
      status: "ready",
    });
  });
  it("rejects API-key authentication and removes failed profiles", async () => {
    await subprocessClaudeRunner.start({ sessionId: profileId });
    mocks.exit?.(0);
    mocks.auth.mockResolvedValue({
      stdout: '{"loggedIn":true,"authMethod":"api_key"}',
    });
    await expect(
      subprocessClaudeRunner.poll({ runnerId }),
    ).resolves.toMatchObject({ status: "failed" });
    await subprocessClaudeRunner.dispose({ runnerId });
    expect(mocks.rm).toHaveBeenCalledWith(
      expect.stringContaining(profileId),
      expect.objectContaining({ recursive: true }),
    );
  });
  it("stops the process before deleting its profile and rejects multiline codes", async () => {
    await subprocessClaudeRunner.start({ sessionId: profileId });
    await expect(
      subprocessClaudeRunner.submitCode({ runnerId, code: "code\ncommand" }),
    ).rejects.toThrow(/Invalid/);
    await subprocessClaudeRunner.dispose({ runnerId });
    expect(mocks.kill).toHaveBeenCalledOnce();
    expect(mocks.kill.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rm.mock.invocationCallOrder[0]!,
    );
  });
});
