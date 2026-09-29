import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveHosted: vi.fn(),
  decryptMaterial: vi.fn(),
  decryptSecret: vi.fn(),
  claudeRuntime: vi.fn(),
  rows: [] as Array<Record<string, unknown>[]>,
  belongs: vi.fn(),
}));

vi.mock("./hosted-codex-subscription-credentials", () => ({
  resolveHostedCodexSubscription: (...args: unknown[]) =>
    mocks.resolveHosted(...args),
  decryptHostedMaterial: (...args: unknown[]) => mocks.decryptMaterial(...args),
}));

vi.mock("./claude-connection-session", () => ({
  getConnectedClaudeRuntime: (...args: unknown[]) =>
    mocks.claudeRuntime(...args),
}));

vi.mock("../platform/kms", () => ({
  decryptSecret: (...args: unknown[]) => mocks.decryptSecret(...args),
}));

vi.mock("./scoped-credential-sharing", () => ({
  belongsToSharedScope: (...args: unknown[]) => mocks.belongs(...args),
}));

vi.mock("../platform/database", () => {
  const query = {
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: async () => mocks.rows.shift() ?? [],
    then: (resolve: (rows: unknown[]) => unknown) =>
      resolve(mocks.rows.shift() ?? []),
  };
  return { getDatabase: () => ({ select: () => query }) };
});

const { providerReadiness, resolveCredential } = await import("./resolve");

const userId = "user-1";

describe("resolveCredential", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rows.length = 0;
    mocks.resolveHosted.mockResolvedValue(null);
    mocks.claudeRuntime.mockResolvedValue(null);
    mocks.belongs.mockResolvedValue(true);
  });

  it("says a credential is connected-but-unrunnable rather than missing", async () => {
    // The member has Claude's browser runtime, which rooms can run and a
    // coding workspace cannot. Telling them "not connected" would send them
    // to connect a thing they already have.
    mocks.claudeRuntime.mockResolvedValue({ id: "connection-1" });

    const rooms = await resolveCredential({
      userId,
      provider: "claude",
      surface: "rooms",
      dryRun: true,
    });
    expect(rooms).toMatchObject({ ok: true, kind: "claude_runtime" });

    const workspace = await resolveCredential({
      userId,
      provider: "claude",
      surface: "workspace",
      dryRun: true,
    });
    expect(workspace).toMatchObject({
      ok: false,
      reason: "unsupported_here",
      connectedKinds: ["claude_runtime"],
    });
  });

  it("reports nothing connected as not_connected", async () => {
    const result = await resolveCredential({
      userId,
      provider: "codex",
      surface: "gen2",
      dryRun: true,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "not_connected",
      connectedKinds: [],
    });
  });

  it("honours the member's shared-workspace choice, and only there", async () => {
    mocks.resolveHosted.mockResolvedValue({
      source: "USER",
      credential: {
        id: "cred-1",
        encryptedMaterial: "enc",
        allowInSharedWorkspaces: false,
      },
    });

    // This is the flag the old per-surface columns only pretended to be:
    // every resolution path reads it, so turning it off actually stops a
    // turn instead of changing a badge.
    const gen2 = await resolveCredential({
      userId,
      provider: "codex",
      surface: "gen2",
      dryRun: true,
    });
    expect(gen2).toMatchObject({
      ok: false,
      reason: "not_allowed_in_shared_workspaces",
    });

    // A chat room is the member's own session, so it is never gated.
    const rooms = await resolveCredential({
      userId,
      provider: "codex",
      surface: "rooms",
      dryRun: true,
    });
    expect(rooms).toMatchObject({ ok: true, kind: "codex_auth_cache" });
  });

  it("never reaches a shared credential without a workspace id", async () => {
    mocks.resolveHosted.mockResolvedValue(null);
    await resolveCredential({
      userId,
      provider: "codex",
      surface: "gen2",
      dryRun: true,
    });
    // Gen 2 bills the member who asked, so it passes no workspace id and the
    // shared lookup cannot run.
    expect(mocks.resolveHosted).toHaveBeenCalledWith(
      expect.not.objectContaining({ workspaceId: expect.anything() }),
    );
  });

  it("does not decrypt anything on a dry run", async () => {
    mocks.resolveHosted.mockResolvedValue({
      source: "USER",
      credential: { id: "cred-1", encryptedMaterial: "enc" },
    });
    await resolveCredential({
      userId,
      provider: "codex",
      surface: "rooms",
      dryRun: true,
    });
    expect(mocks.decryptMaterial).not.toHaveBeenCalled();
  });

  it("decrypts only when a turn actually needs the secret", async () => {
    mocks.resolveHosted.mockResolvedValue({
      source: "USER",
      credential: { id: "cred-1", encryptedMaterial: "enc" },
    });
    mocks.decryptMaterial.mockResolvedValue({ authCacheJson: '{"a":1}' });
    const result = await resolveCredential({
      userId,
      provider: "codex",
      surface: "rooms",
    });
    expect(result).toMatchObject({
      ok: true,
      secret: { kind: "codex_auth_cache", authCacheJson: '{"a":1}' },
    });
  });
});

describe("providerReadiness", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rows.length = 0;
    mocks.resolveHosted.mockResolvedValue(null);
    mocks.claudeRuntime.mockResolvedValue(null);
    mocks.belongs.mockResolvedValue(true);
  });

  it("answers for every provider and executor from the same walk a turn takes", async () => {
    mocks.resolveHosted.mockResolvedValue({
      source: "USER",
      credential: { id: "cred-1", encryptedMaterial: "enc" },
    });

    const report = await providerReadiness(userId);

    expect(report.codex.rooms.ready).toBe(true);
    expect(report.codex.gen2.ready).toBe(true);
    expect(report.claude.rooms.ready).toBe(false);
    expect(report.cursor.rooms.ready).toBe(false);
    expect(mocks.decryptMaterial).not.toHaveBeenCalled();
  });
});
