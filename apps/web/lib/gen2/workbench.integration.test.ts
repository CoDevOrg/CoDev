import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Gen 2 workbench against the in-memory guest.
 *
 * Everything below `lib/gen2` is real: the domain modules, the orchestrator
 * clients, the HTTP shapes, the parsers. Only the guest itself and the
 * membership lookup are doubled. These are the integration bugs static checks
 * cannot reach -- a wrong path, a mis-shaped body, a revision that does not
 * round-trip.
 */

process.env.CODEV_FAKE_GUEST = "1";
process.env.ORCHESTRATOR_DIRECT_URL = "https://orchestrator.invalid";
process.env.ORCHESTRATOR_DIRECT_SECRET = "x".repeat(40);

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("../policies/workspace", () => ({
  requireWorkspacePermission: (...args: unknown[]) =>
    mocks.requirePermission(...args),
}));

vi.mock("./workspaces", () => ({
  getGen2WorkspaceForAccess: (...args: unknown[]) => mocks.workspace(...args),
}));

vi.mock("./instance", () => ({
  describeGen2RuntimeFailure: (error: unknown) =>
    error instanceof Error ? error.message : "runtime failure",
}));

vi.mock("./providers", () => ({
  resolveGen2Codex: vi.fn(),
}));

vi.mock("../providers/hosted-codex-subscription-credentials", () => ({
  HostedCodexSubscriptionError: class HostedCodexSubscriptionError extends Error {},
  claimHostedCodexExecution: vi.fn(),
  releaseHostedCodexExecution: vi.fn(),
  resolveHostedCodexSubscription: vi.fn(),
  updateHostedCodexAuthCache: vi.fn(),
}));

vi.mock("../platform/azure-kms", () => ({
  decryptWithAzure: vi.fn(),
  encryptWithAzure: vi.fn(),
}));

const { resetFakeGuest, fakeGuestSandbox } =
  await import("../runtime/fake-guest");
const { provisionSandbox } = await import("../runtime/orchestrator-sandbox");
const {
  getGen2Git,
  listGen2Files,
  readGen2File,
  searchGen2Files,
  showGen2HeadFile,
  uploadGen2File,
  writeGen2File,
} = await import("./workbench");
const {
  startCodexExecInSandbox,
  pollCodexExecInSandbox,
  closeCodexExecInSandbox,
} = await import("../runtime/orchestrator-codex-exec");
const { decodeCodexExecOutput } = await import("./codex-output");
const { reduceCodexTurn } = await import("./turn-events");
const { buildGen2CodexCommand } = await import("./providers/openai");
const {
  closeGen2Terminal,
  pollGen2Terminal,
  sendGen2TerminalInput,
  startGen2Terminal,
} = await import("./terminals");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

async function bootMachine() {
  await provisionSandbox({
    workspaceId,
    repositoryUrl: null,
    repositorySnapshot: { files: [], totalBytes: 0 },
    baseSha: "0".repeat(40),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    resumeFromSnapshot: false,
    lifecycle: {
      timeoutMs: 4 * 60 * 60 * 1000,
      lifecycle: { onTimeout: "pause", autoResume: true },
    },
  });
}

describe("gen2 workbench against the guest", () => {
  beforeEach(async () => {
    resetFakeGuest();
    mocks.requirePermission.mockResolvedValue({
      role: "owner",
      capabilities: {},
    });
    mocks.workspace.mockResolvedValue({
      id: workspaceId,
      status: "ready",
      role: "owner",
      repository: null,
    });
    await bootMachine();
  });

  it("lists the machine's files", async () => {
    await expect(listGen2Files(workspaceId, userId)).resolves.toEqual([
      { path: "README.md", status: null },
    ]);
  });

  it("round-trips an edit through read, write and read again", async () => {
    const opened = await readGen2File(workspaceId, userId, "README.md");
    expect(opened.contents).toContain("CoDev workspace");

    const saved = await writeGen2File(workspaceId, userId, {
      path: "README.md",
      contents: "rewritten\n",
      expectedRevision: opened.revision,
    });
    expect(saved.revision).not.toBe(opened.revision);

    const reopened = await readGen2File(workspaceId, userId, "README.md");
    expect(reopened.contents).toBe("rewritten\n");
    expect(reopened.revision).toBe(saved.revision);
  });

  it("refuses a save that raced another writer", async () => {
    const opened = await readGen2File(workspaceId, userId, "README.md");
    await writeGen2File(workspaceId, userId, {
      path: "README.md",
      contents: "theirs\n",
      expectedRevision: opened.revision,
    });
    // Second save still holds the revision it opened at.
    await expect(
      writeGen2File(workspaceId, userId, {
        path: "README.md",
        contents: "mine\n",
        expectedRevision: opened.revision,
      }),
    ).rejects.toMatchObject({ status: 409, path: "README.md" });
  });

  it("shows an edited file as modified in Git, with a diff", async () => {
    const opened = await readGen2File(workspaceId, userId, "README.md");
    await writeGen2File(workspaceId, userId, {
      path: "README.md",
      contents: "changed\n",
      expectedRevision: opened.revision,
    });
    expect(await getGen2Git(workspaceId, userId, "status")).toContain(
      "M README.md",
    );
    const diff = await getGen2Git(workspaceId, userId, "diff");
    expect(diff).toContain("+changed");
  });

  it("uploads a file and finds it in the tree and in search", async () => {
    await uploadGen2File(workspaceId, userId, {
      path: "notes.txt",
      contents: "remember the milk\n",
    });
    const files = await listGen2Files(workspaceId, userId);
    // A brand-new file is untracked, not modified.
    expect(files).toContainEqual({ path: "notes.txt", status: "??" });
    await expect(searchGen2Files(workspaceId, userId, "milk")).resolves.toEqual(
      [{ path: "notes.txt", line: 1, preview: "remember the milk" }],
    );
  });

  it("will not silently overwrite on upload", async () => {
    await uploadGen2File(workspaceId, userId, {
      path: "notes.txt",
      contents: "first\n",
    });
    await expect(
      uploadGen2File(workspaceId, userId, {
        path: "notes.txt",
        contents: "second\n",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("reports a file with no committed version rather than an empty one", async () => {
    await uploadGen2File(workspaceId, userId, {
      path: "fresh.txt",
      contents: "new\n",
    });
    await expect(
      showGen2HeadFile(workspaceId, userId, "fresh.txt"),
    ).resolves.toEqual({ contents: "", exists: false });
    await expect(
      showGen2HeadFile(workspaceId, userId, "README.md"),
    ).resolves.toMatchObject({ exists: true });
  });

  it("runs a terminal: open, type, read the output back, close", async () => {
    const sessionId = await startGen2Terminal(workspaceId, userId, {
      rows: 24,
      columns: 80,
    });
    expect(sessionId).toMatch(/^term-\d+-\d+$/);

    const banner = await pollGen2Terminal(workspaceId, userId, sessionId, 0);
    expect(banner.chunks.map((chunk) => chunk.data).join("")).toContain(
      "codev:/workspace$",
    );

    await sendGen2TerminalInput(workspaceId, userId, sessionId, "ls\r");
    const after = await pollGen2Terminal(
      workspaceId,
      userId,
      sessionId,
      banner.nextSequence,
    );
    expect(after.chunks.map((chunk) => chunk.data).join("")).toContain(
      "README.md",
    );

    await closeGen2Terminal(workspaceId, userId, sessionId);
    expect(fakeGuestSandbox(workspaceId)?.terminals.size).toBe(0);
  });

  it("does not replay terminal output the client already read", async () => {
    const sessionId = await startGen2Terminal(workspaceId, userId, {
      rows: 24,
      columns: 80,
    });
    const first = await pollGen2Terminal(workspaceId, userId, sessionId, 0);
    const second = await pollGen2Terminal(
      workspaceId,
      userId,
      sessionId,
      first.nextSequence,
    );
    expect(second.chunks).toEqual([]);
  });

  it("runs a Codex turn end to end and reduces it into activity", async () => {
    // The real command builder, the real exec transport, the real decoder and
    // the real reducer -- only the guest is doubled.
    const sessionId = await startCodexExecInSandbox(workspaceId, {
      command: buildGen2CodexCommand("add a note about the parser", []),
      codexAuthCacheJson: JSON.stringify({ auth_mode: "apikey" }),
      idempotencyKey: "idem-integration-1",
    });

    const poll = await pollCodexExecInSandbox(workspaceId, sessionId, 0);
    expect(poll.exited).toBe(true);

    const state = reduceCodexTurn(decodeCodexExecOutput(poll.chunks));
    expect(state.status).toBe("completed");
    expect(state.items.map((item) => item.kind)).toEqual([
      "reasoning",
      "command",
      "fileChange",
      "message",
    ]);
    expect(state.reply).toContain("NOTES.md");
    expect(state.usage).toMatchObject({ inputTokens: 42 });

    // The turn really wrote to the machine, so the paths in the card open.
    const change = state.items.find((item) => item.kind === "fileChange");
    expect(change).toMatchObject({ changes: [{ path: "NOTES.md" }] });
    await expect(
      readGen2File(workspaceId, userId, "NOTES.md"),
    ).resolves.toMatchObject({ contents: expect.stringContaining("parser") });

    await closeCodexExecInSandbox(workspaceId, sessionId);
  });

  it("surfaces the agent's new file to the workbench", async () => {
    const sessionId = await startCodexExecInSandbox(workspaceId, {
      command: buildGen2CodexCommand("take a note", []),
      codexAuthCacheJson: "{}",
      idempotencyKey: "idem-integration-2",
    });
    await pollCodexExecInSandbox(workspaceId, sessionId, 0);

    // What the agent wrote is what the human sees -- one filesystem.
    const files = await listGen2Files(workspaceId, userId);
    expect(files).toContainEqual({ path: "NOTES.md", status: "??" });
    expect(await getGen2Git(workspaceId, userId, "status")).toContain(
      "NOTES.md",
    );
  });
});
