import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  rows: [] as Array<{ allowFileChanges: boolean }>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../policies/workspace", () => ({
  requireWorkspacePermission: (...args: unknown[]) =>
    mocks.requirePermission(...args),
}));

vi.mock("../platform/database", () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.rows }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updates.push(values);
        return {
          where: () => ({
            returning: async () => [
              { allowFileChanges: values.agentFileChanges },
            ],
          }),
        };
      },
    }),
  }),
}));

import {
  getGen2AgentExecutionPolicy,
  updateGen2AgentExecutionPolicy,
} from "./workspace-policy";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

describe("Gen 2 workspace execution policy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rows = [{ allowFileChanges: true }];
    mocks.updates.length = 0;
    mocks.requirePermission.mockResolvedValue({});
  });

  it("returns the persisted effective policy after view authorization", async () => {
    await expect(
      getGen2AgentExecutionPolicy(workspaceId, userId),
    ).resolves.toEqual({ allowFileChanges: true });
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "workspace.view",
    );
  });

  it("requires workspace.managePolicy before saving a policy", async () => {
    await expect(
      updateGen2AgentExecutionPolicy({
        workspaceId,
        userId,
        policy: { allowFileChanges: false },
      }),
    ).resolves.toEqual({ allowFileChanges: false });
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      workspaceId,
      userId,
      "workspace.managePolicy",
    );
    expect(mocks.updates).toEqual([
      expect.objectContaining({ agentFileChanges: false }),
    ]);
  });

  it("does not write when the server denies policy management", async () => {
    mocks.requirePermission.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    await expect(
      updateGen2AgentExecutionPolicy({
        workspaceId,
        userId,
        policy: { allowFileChanges: false },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.updates).toEqual([]);
  });
});
