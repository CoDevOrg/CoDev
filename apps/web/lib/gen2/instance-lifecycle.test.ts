import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updates: Array<Record<string, unknown>> = [];
  const member = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Studio",
    status: "pending" as string,
    sandboxId: null as string | null,
    lastError: null as string | null,
    role: "owner" as const,
    createdAt: new Date("2026-09-20T20:00:00.000Z"),
    updatedAt: new Date("2026-09-20T20:00:00.000Z"),
  };
  const selectQuery = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  const updateQuery = {
    set: vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      if (typeof values.status === "string") {
        member.status = values.status;
      }
      if ("sandboxId" in values) {
        member.sandboxId = values.sandboxId as string | null;
      }
      if ("lastError" in values) {
        member.lastError = values.lastError as string | null;
      }
      return updateQuery;
    }),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    updates,
    member,
    selectQuery,
    updateQuery,
    database: {
      select: vi.fn(() => selectQuery),
      update: vi.fn(() => updateQuery),
    },
    provision: vi.fn(),
    destroy: vi.fn(),
    ensureHostReady: vi.fn(),
  };
});

vi.mock("../platform/database", () => ({
  getDatabase: () => mocks.database,
}));

vi.mock("../platform/crypto", () => ({
  createInviteToken: vi.fn(),
  hashInviteToken: vi.fn(),
}));

vi.mock("../platform/observability", () => ({
  logEvent: vi.fn(),
}));

vi.mock("../runtime/orchestrator-health", () => ({
  ensureHostReady: (...args: unknown[]) => mocks.ensureHostReady(...args),
}));

import { Gen2LifecycleError } from "./errors";
import { startGen2Instance, stopGen2Instance } from "./instance";

describe("gen2 instance lifecycle", () => {
  beforeEach(() => {
    mocks.updates.length = 0;
    mocks.member.status = "pending";
    mocks.member.sandboxId = null;
    mocks.member.lastError = null;
    mocks.member.role = "owner";
    for (const method of ["from", "innerJoin", "where"] as const) {
      mocks.selectQuery[method].mockReturnValue(mocks.selectQuery);
    }
    mocks.selectQuery.limit.mockResolvedValue([mocks.member]);
    mocks.provision.mockReset();
    mocks.destroy.mockReset();
    mocks.ensureHostReady.mockReset();
    mocks.provision.mockResolvedValue({ id: "sandbox-1" });
    mocks.destroy.mockResolvedValue(undefined);
    mocks.ensureHostReady.mockResolvedValue(undefined);
  });

  it("provisions a Firecracker sandbox and marks the workspace ready", async () => {
    const workspace = await startGen2Instance(mocks.member.id, "user-1", {
      provision: mocks.provision,
      destroy: mocks.destroy,
    });
    expect(mocks.provision).toHaveBeenCalledWith(
      mocks.member.id,
      expect.any(Date),
    );
    expect(mocks.updates.map((update) => update.status)).toEqual([
      "provisioning",
      "ready",
    ]);
    expect(workspace.status).toBe("ready");
    expect(workspace.sandboxId).toBe("sandbox-1");
    expect(mocks.ensureHostReady).toHaveBeenCalledOnce();
  });

  it("reattaches when the Firecracker machine is already on the host", async () => {
    const current = vi.fn().mockResolvedValue({ id: "sandbox-1" });
    const workspace = await startGen2Instance(mocks.member.id, "user-1", {
      provision: mocks.provision,
      destroy: mocks.destroy,
      current,
    });
    expect(current).toHaveBeenCalledWith(mocks.member.id);
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(workspace.status).toBe("ready");
    expect(workspace.sandboxId).toBe("sandbox-1");
  });

  it("does not mark the workspace failed when the host is still waking", async () => {
    mocks.ensureHostReady.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      startGen2Instance(mocks.member.id, "user-1", {
        provision: mocks.provision,
        destroy: mocks.destroy,
      }),
    ).rejects.toMatchObject({
      message: /Firecracker host could not be reached/,
      status: 503,
    });
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.updates[0]).toMatchObject({ status: "provisioning" });
    expect(mocks.updates.at(-1)).toMatchObject({
      status: "pending",
      lastError: expect.stringMatching(/Firecracker host could not be reached/),
    });
  });

  it("does not surface a raw fetch failure when the host is unreachable", async () => {
    mocks.provision.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      startGen2Instance(mocks.member.id, "user-1", {
        provision: mocks.provision,
        destroy: mocks.destroy,
      }),
    ).rejects.toMatchObject({
      message: /Firecracker host could not be reached/,
      status: 502,
    });
    expect(mocks.updates.at(-1)).toMatchObject({
      status: "failed",
      lastError: expect.stringMatching(/Firecracker host could not be reached/),
    });
  });

  it("marks the workspace failed when provisioning throws", async () => {
    mocks.provision.mockRejectedValue(new Error("host unavailable"));
    await expect(
      startGen2Instance(mocks.member.id, "user-1", {
        provision: mocks.provision,
        destroy: mocks.destroy,
      }),
    ).rejects.toBeInstanceOf(Gen2LifecycleError);
    expect(mocks.updates.at(-1)).toMatchObject({
      status: "failed",
      lastError: "host unavailable",
    });
  });

  it("destroys the sandbox when the owner stops it", async () => {
    mocks.member.status = "ready";
    mocks.member.sandboxId = "sandbox-1";
    const workspace = await stopGen2Instance(mocks.member.id, "user-1", {
      provision: mocks.provision,
      destroy: mocks.destroy,
    });
    expect(mocks.destroy).toHaveBeenCalledWith(mocks.member.id);
    expect(workspace.status).toBe("stopped");
    expect(workspace.sandboxId).toBeNull();
  });
});
