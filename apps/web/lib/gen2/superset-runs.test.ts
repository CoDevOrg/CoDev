import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock("../platform/database", () => ({
  getDatabase: databaseMocks.getDatabase,
}));

import {
  claimGen2SupersetRunLease,
  markGen2SupersetRunFailed,
  markGen2SupersetRunRecoveryRequired,
  markGen2SupersetRunStarted,
  registerGen2SupersetRun,
  releaseGen2SupersetRunLease,
} from "./superset-runs";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function selectQuery(returned: unknown[] = []) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(returned),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
}

function updateQuery(returned: unknown[] = []) {
  const query = { set: vi.fn(), where: vi.fn(), returning: vi.fn() };
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue(returned);
  return query;
}

function insertQuery(returned: unknown[] = []) {
  const query = { values: vi.fn() };
  query.values.mockReturnValue({
    ...query,
    returning: vi.fn().mockResolvedValue(returned),
  });
  return query;
}

describe("gen2 Superset run lifecycle", () => {
  beforeEach(() => {
    databaseMocks.getDatabase.mockReset();
  });

  it("creates a run on first registration and audits it", async () => {
    const runSelect = selectQuery([]);
    const runInsert = insertQuery([{ id: RUN_ID }]);
    const eventInsert = { values: vi.fn().mockResolvedValue(undefined) };
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValueOnce(runSelect),
      insert: vi
        .fn()
        .mockReturnValueOnce(runInsert)
        .mockReturnValueOnce(eventInsert),
    };
    databaseMocks.getDatabase.mockReturnValue({
      transaction: vi.fn(async (callback) => callback(transaction)),
    });

    await expect(
      registerGen2SupersetRun({
        workspaceId: WORKSPACE_ID,
        createdBy: USER_ID,
        worktreeId: "main",
        provider: "openai",
        idempotencyKey: "key-1",
      }),
    ).resolves.toEqual({ runId: RUN_ID, status: "creating", created: true });
    expect(eventInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ type: "run_created", result: "success" }),
    );
  });

  it("returns the existing run instead of creating a second one on retry", async () => {
    const runSelect = selectQuery([{ id: RUN_ID, status: "running" }]);
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValueOnce(runSelect),
      insert: vi.fn(),
    };
    databaseMocks.getDatabase.mockReturnValue({
      transaction: vi.fn(async (callback) => callback(transaction)),
    });

    await expect(
      registerGen2SupersetRun({
        workspaceId: WORKSPACE_ID,
        createdBy: USER_ID,
        worktreeId: "main",
        provider: "openai",
        idempotencyKey: "key-1",
      }),
    ).resolves.toEqual({ runId: RUN_ID, status: "running", created: false });
    expect(transaction.insert).not.toHaveBeenCalled();
  });

  it("records host identifiers when a run starts", async () => {
    const runUpdate = updateQuery([{ id: RUN_ID }]);
    const eventInsert = { values: vi.fn().mockResolvedValue(undefined) };
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockReturnValueOnce(runUpdate),
      insert: vi.fn().mockReturnValueOnce(eventInsert),
    };
    databaseMocks.getDatabase.mockReturnValue({
      transaction: vi.fn(async (callback) => callback(transaction)),
    });

    await markGen2SupersetRunStarted({
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      hostWorkspaceId: "host-ws-1",
      hostTerminalId: "term-1",
      hostAgentSessionId: "agent-1",
    });
    expect(runUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running", hostTerminalId: "term-1" }),
    );
  });

  it("throws instead of silently no-oping when the run row is missing", async () => {
    const runUpdate = updateQuery([]);
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockReturnValueOnce(runUpdate),
      insert: vi.fn(),
    };
    databaseMocks.getDatabase.mockReturnValue({
      transaction: vi.fn(async (callback) => callback(transaction)),
    });

    await expect(
      markGen2SupersetRunFailed({
        runId: RUN_ID,
        workspaceId: WORKSPACE_ID,
        lastError: "boom",
      }),
    ).rejects.toThrow("Superset run not found.");
  });

  it("is a no-op releasing a lease that was never claimed", async () => {
    const runSelect = selectQuery([{ leaseClaimed: false }]);
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValueOnce(runSelect),
      update: vi.fn(),
      insert: vi.fn(),
    };
    databaseMocks.getDatabase.mockReturnValue({
      transaction: vi.fn(async (callback) => callback(transaction)),
    });

    await releaseGen2SupersetRunLease({
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(transaction.update).not.toHaveBeenCalled();
  });

  it("claims a lease and audits it", async () => {
    const runUpdate = updateQuery();
    const eventInsert = { values: vi.fn().mockResolvedValue(undefined) };
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockReturnValueOnce(runUpdate),
      insert: vi.fn().mockReturnValueOnce(eventInsert),
    };
    databaseMocks.getDatabase.mockReturnValue({
      transaction: vi.fn(async (callback) => callback(transaction)),
    });

    await claimGen2SupersetRunLease({
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(runUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ leaseClaimed: true }),
    );
    expect(eventInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ type: "lease_claimed" }),
    );
  });

  it("bumps the recovery count instead of relaunching automatically", async () => {
    const runUpdate = updateQuery([{ id: RUN_ID }]);
    const eventInsert = { values: vi.fn().mockResolvedValue(undefined) };
    const transaction = {
      execute: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockReturnValueOnce(runUpdate),
      insert: vi.fn().mockReturnValueOnce(eventInsert),
    };
    databaseMocks.getDatabase.mockReturnValue({
      transaction: vi.fn(async (callback) => callback(transaction)),
    });

    await markGen2SupersetRunRecoveryRequired({
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      lastError: "host restarted",
    });
    expect(runUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "recovery_required" }),
    );
    expect(eventInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recovery_required", result: "failure" }),
    );
  });
});
