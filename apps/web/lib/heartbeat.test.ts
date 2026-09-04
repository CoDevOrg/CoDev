import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updateQuery = { set: vi.fn(), where: vi.fn() };
  const transaction = { update: vi.fn(() => updateQuery) };
  const database = {
    transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  updateQuery.set.mockReturnValue(updateQuery);
  updateQuery.where.mockResolvedValue(undefined);

  return { database, transaction, updateQuery, touchSandbox: vi.fn() };
});

vi.mock("@codev/config", () => ({
  readServerEnvironment: () => ({ REDIS_URL: undefined }),
}));
vi.mock("./database", () => ({ getDatabase: () => mocks.database }));
vi.mock("./orchestrator", () => ({
  touchSandbox: mocks.touchSandbox.mockResolvedValue(undefined),
}));

import { recordWorkspaceHeartbeat } from "./heartbeat";
import { workspaceHibernateIdleMs } from "./workspaces";

describe("recordWorkspaceHeartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateQuery.set.mockReturnValue(mocks.updateQuery);
    mocks.updateQuery.where.mockResolvedValue(undefined);
    mocks.touchSandbox.mockResolvedValue(undefined);
  });

  it("pushes hibernateAt forward by the idle-hibernation window instead of clearing it", async () => {
    const before = Date.now();
    const result = await recordWorkspaceHeartbeat("workspace-1");
    const after = Date.now();

    expect(result.hibernateAt).toBeInstanceOf(Date);
    const deadline = result.hibernateAt.getTime();
    expect(deadline).toBeGreaterThanOrEqual(before + workspaceHibernateIdleMs);
    expect(deadline).toBeLessThanOrEqual(after + workspaceHibernateIdleMs);

    const workspaceUpdateCall = mocks.updateQuery.set.mock.calls[0]?.[0];
    expect(workspaceUpdateCall).toMatchObject({
      hibernateAt: result.hibernateAt,
    });
  });
});
