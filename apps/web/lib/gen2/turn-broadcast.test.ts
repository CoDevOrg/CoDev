import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  sync: vi.fn(),
  set: vi.fn(),
}));
vi.mock("./workspace-events", () => ({
  publishGen2WorkspaceEvent: mocks.publish,
}));
vi.mock("./turn-file-sync", () => ({ syncAgentFiles: mocks.sync }));
vi.mock("./collaboration-redis", () => ({
  redisClient: () => ({ set: mocks.set }),
}));
vi.mock("../platform/observability", () => ({ logEvent: vi.fn() }));

import {
  broadcastGen2TurnPolls,
  compactTurnProgress,
  type Gen2TurnPoll,
} from "./turn-broadcast";

const codexLine = (event: unknown) => `${JSON.stringify(event)}\n`;
const poll = (overrides: Partial<Gen2TurnPoll> = {}): Gen2TurnPoll => ({
  turn: {
    workspaceId: "w",
    chatId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
    sessionId: "s1",
    userId: "c010bd2c-a3c1-438f-acef-166287a3b1cb",
    provider: "codex",
    worktreeId: "feature",
  },
  output: codexLine({
    type: "item.completed",
    item: { id: "i1", type: "agent_message", text: "Working on it" },
  }),
  exited: false,
  exitCode: null,
  message: null,
  ...overrides,
});

describe("broadcastGen2TurnPolls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pushes progress at most once per interval", async () => {
    mocks.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
    await broadcastGen2TurnPolls([poll(), poll()]);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish.mock.calls[0]![1]).toMatchObject({
      kind: "turn.progress",
      sessionId: "s1",
    });
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it("always announces the end of a turn", async () => {
    await broadcastGen2TurnPolls([poll({ exited: true, exitCode: 0 })]);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.publish.mock.calls[0]![1]).toMatchObject({
      kind: "turn.settled",
      sessionId: "s1",
    });
  });

  it("never throws into the poller", async () => {
    mocks.sync.mockRejectedValueOnce(new Error("guest unreachable"));
    await expect(broadcastGen2TurnPolls([poll()])).resolves.toBeUndefined();
  });
});

describe("compactTurnProgress", () => {
  it("fits a huge turn into one socket frame", () => {
    const items = Array.from({ length: 200 }, (_, index) => ({
      id: `c${index}`,
      status: "completed" as const,
      kind: "command" as const,
      command: "npm test",
      output: "x".repeat(10_000),
      exitCode: 0,
    }));
    const compact = compactTurnProgress({
      items,
      reply: "y".repeat(100_000),
      error: null,
      usage: null,
      status: "running",
    });
    expect(JSON.stringify(compact).length).toBeLessThan(48 * 1_024);
    expect(compact.truncated).toBe(true);
    expect(compact.items.at(-1)?.id).toBe("c199");
  });
});
