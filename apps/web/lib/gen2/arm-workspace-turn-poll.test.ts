import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  row: {} as Record<string, unknown> | null,
  locked: true,
  poll: vi.fn(),
  record: vi.fn(),
  broadcast: vi.fn(),
  inTransaction: false,
}));
const transaction = {
  execute: async () => ({ rows: [{ locked: mocks.locked }] }),
  select: (fields?: unknown) => ({
    from: () => ({
      where: () => ({
        limit: async () =>
          fields ? [{ body: "saved reply" }] : mocks.row ? [mocks.row] : [],
      }),
    }),
  }),
};
vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    transaction: async (
      action: (db: typeof transaction) => Promise<unknown>,
    ) => {
      mocks.inTransaction = true;
      try {
        return await action(transaction);
      } finally {
        mocks.inTransaction = false;
      }
    },
  }),
}));
vi.mock("../runtime/orchestrator-codex-exec", () => ({
  pollCodexExecInSandbox: mocks.poll,
}));
vi.mock("./turns", () => ({ recordGen2TurnChunks: mocks.record }));
vi.mock("./turn-broadcast", () => ({
  broadcastGen2TurnPolls: mocks.broadcast,
}));
import { pollPersistedArmTurn } from "./arm-workspace-turn-poll";
const input = { workspaceId: "workspace-a", sessionId: "session-a", after: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.locked = true;
  mocks.row = {
    sessionId: "session-a",
    workspaceId: "workspace-a",
    nextSequence: 2,
    output: "earlier\n",
    pendingBase64: "",
    exited: false,
    replyMessageId: null,
  };
  mocks.record.mockResolvedValue(null);
});
it("acknowledges only chunks persisted, including the guest's 128-chunk limit", async () => {
  const chunks = Array.from({ length: 128 }, (_, index) => ({
    sequence: index + 2,
    dataBase64: "YQ==",
  }));
  mocks.poll.mockResolvedValue({
    chunks,
    nextSequence: 300,
    exited: true,
    exitCode: 0,
  });
  const result = await pollPersistedArmTurn(input);
  expect(mocks.poll).toHaveBeenCalledWith(
    "workspace-a",
    "session-a",
    2,
    transaction,
  );
  expect(mocks.record).toHaveBeenCalledWith(
    {
      sessionId: "session-a",
      chunks,
      nextSequence: 130,
      exited: false,
      exitCode: 0,
    },
    transaction,
    expect.any(Array),
  );
  expect(result.nextSequence).toBe(130);
  expect(result.exited).toBe(false);
});
it("a concurrent browser gets persisted history without issuing a competing guest poll", async () => {
  mocks.locked = false;
  const result = await pollPersistedArmTurn({ ...input, after: 0 });
  expect(mocks.poll).not.toHaveBeenCalled();
  expect(Buffer.from(result.chunks[0]!.dataBase64, "base64").toString()).toBe(
    "earlier\n",
  );
});
it("replays a completed reply after VM release without touching the guest", async () => {
  mocks.row!.exited = true;
  mocks.row!.replyMessageId = "message-a";
  const result = await pollPersistedArmTurn({ ...input, after: 0 });
  expect(result.persisted).toEqual({
    reply: "saved reply",
    messageId: "message-a",
  });
  expect(result.exited).toBe(true);
  expect(mocks.poll).not.toHaveBeenCalled();
});
it("a persistence failure rejects the transaction before any later acknowledgement", async () => {
  mocks.poll.mockResolvedValue({
    chunks: [{ sequence: 2, dataBase64: "YQ==" }],
    nextSequence: 3,
    exited: false,
    exitCode: null,
  });
  mocks.record.mockRejectedValue(new Error("database failed"));
  await expect(pollPersistedArmTurn(input)).rejects.toThrow("database failed");
  expect(mocks.row!.nextSequence).toBe(2);
  expect(mocks.poll).toHaveBeenCalledTimes(1);
});
it("an absent turn never reaches the guest", async () => {
  mocks.row = null;
  await expect(pollPersistedArmTurn(input)).rejects.toMatchObject({
    status: 404,
  });
  expect(mocks.poll).not.toHaveBeenCalled();
});

it("tells members about a poll only after its transaction commits", async () => {
  mocks.poll.mockResolvedValue({
    chunks: [{ sequence: 2, dataBase64: "YQ==" }],
    nextSequence: 3,
    exited: false,
    exitCode: null,
  });
  mocks.record.mockImplementation(async (_input, _tx, sink: unknown[]) => {
    sink.push({ poll: 1 });
    return null;
  });
  mocks.broadcast.mockImplementation(async () => {
    expect(mocks.inTransaction).toBe(false);
  });
  await pollPersistedArmTurn(input);
  expect(mocks.broadcast).toHaveBeenCalledWith([{ poll: 1 }]);
});
