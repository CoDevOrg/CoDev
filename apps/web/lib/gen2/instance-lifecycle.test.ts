import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updates: Array<Record<string, unknown>> = [];
  const member = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Studio",
    status: "pending" as string,
    sandboxId: null as string | null,
    lastError: null as string | null,
    role: "owner" as "owner" | "editor" | "viewer",
    createdAt: new Date("2026-09-20T20:00:00.000Z"),
    updatedAt: new Date("2026-09-20T20:00:00.000Z"),
  };
  const selectQuery = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  // Drizzle's update builder is chainable and awaitable, and the claim adds
  // `.returning()`. `claimed` says whether the compare-and-set matched a row;
  // when it does not, the write must not land -- that is the whole point of
  // the claim, and modelling it is how the race test means anything.
  const state = { claimed: true, leaseCurrent: true };
  let pending: Record<string, unknown> | null = null;

  function apply() {
    if (!pending) return;
    const values = pending;
    pending = null;
    updates.push(values);
    if (typeof values.status === "string") member.status = values.status;
    if ("sandboxId" in values) {
      member.sandboxId = values.sandboxId as string | null;
    }
    if ("lastError" in values) {
      member.lastError = values.lastError as string | null;
    }
    if ("updatedAt" in values) {
      member.updatedAt = values.updatedAt as Date;
    }
  }

  const updateQuery = {
    set: vi.fn((values: Record<string, unknown>) => {
      pending = values;
      return updateQuery;
    }),
    where: vi.fn(() => updateQuery),
    returning: vi.fn(async () => {
      const status = pending?.status;
      if (
        (status === "provisioning" && !state.claimed) ||
        (status !== "provisioning" && !state.leaseCurrent)
      ) {
        pending = null;
        return [];
      }
      apply();
      return [{ id: member.id, updatedAt: member.updatedAt }];
    }),
    then: (resolve: (value: undefined) => unknown) => {
      apply();
      return resolve(undefined);
    },
  };

  return {
    updates,
    state,
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
import { ensureGen2Instance, stopGen2Instance } from "./instance";

describe("gen2 instance lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    mocks.updates.length = 0;
    mocks.member.status = "pending";
    mocks.member.sandboxId = null;
    mocks.member.lastError = null;
    mocks.member.updatedAt = new Date("2026-09-20T20:00:00.000Z");
    mocks.member.role = "owner";
    mocks.state.claimed = true;
    mocks.state.leaseCurrent = true;
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
    const workspace = await ensureGen2Instance(mocks.member.id, "user-1", {
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
    expect(mocks.ensureHostReady).toHaveBeenCalledWith(150_000);
  });

  it("reattaches when the Firecracker machine is already on the host", async () => {
    const current = vi.fn().mockResolvedValue({ id: "sandbox-1" });
    const workspace = await ensureGen2Instance(mocks.member.id, "user-1", {
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
      ensureGen2Instance(mocks.member.id, "user-1", {
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
      ensureGen2Instance(mocks.member.id, "user-1", {
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
      ensureGen2Instance(mocks.member.id, "user-1", {
        provision: mocks.provision,
        destroy: mocks.destroy,
      }),
    ).rejects.toBeInstanceOf(Gen2LifecycleError);
    expect(mocks.updates.at(-1)).toMatchObject({
      status: "failed",
      lastError: "host unavailable",
    });
  });

  it("recovers a stale provisioning claim", async () => {
    mocks.member.status = "provisioning";
    mocks.member.updatedAt = new Date(Date.now() - 10 * 60_000);

    const workspace = await ensureGen2Instance(mocks.member.id, "user-1", {
      provision: mocks.provision,
      destroy: mocks.destroy,
    });

    expect(mocks.provision).toHaveBeenCalledOnce();
    expect(mocks.updates.map((update) => update.status)).toEqual([
      "provisioning",
      "ready",
    ]);
    expect(workspace.status).toBe("ready");
  });

  it("records a retryable failure when host wake fails during stale recovery", async () => {
    mocks.member.status = "provisioning";
    mocks.member.updatedAt = new Date(Date.now() - 10 * 60_000);
    mocks.ensureHostReady.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      ensureGen2Instance(mocks.member.id, "user-1", {
        provision: mocks.provision,
        destroy: mocks.destroy,
      }),
    ).rejects.toMatchObject({ status: 503 });

    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.member.status).toBe("failed");
    expect(mocks.updates.at(-1)).toMatchObject({
      status: "failed",
      lastError: expect.stringMatching(/Firecracker host could not be reached/),
    });
  });

  it("does nothing when the machine is already running", async () => {
    mocks.member.status = "ready";
    mocks.member.sandboxId = "sandbox-1";
    const workspace = await ensureGen2Instance(mocks.member.id, "user-1", {
      provision: mocks.provision,
      destroy: mocks.destroy,
    });
    expect(workspace.status).toBe("ready");
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.updates).toEqual([]);
  });

  it("does not restart a workspace once deletion has begun", async () => {
    mocks.member.status = "deleting";
    await expect(
      ensureGen2Instance(mocks.member.id, "user-1", {
        provision: mocks.provision,
        destroy: mocks.destroy,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.ensureHostReady).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("leaves a ready workspace untouched when runtime verification succeeds", async () => {
    mocks.member.status = "ready";
    mocks.member.sandboxId = "sandbox-1";
    const current = vi.fn().mockResolvedValue({ id: "sandbox-1" });

    const workspace = await ensureGen2Instance(mocks.member.id, "user-1", {
      provision: mocks.provision,
      destroy: mocks.destroy,
      current,
    });

    expect(current).toHaveBeenCalledOnce();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.updates).toEqual([]);
    expect(workspace.status).toBe("ready");
  });

  it("reprovisions a ready workspace whose host no longer has its VM", async () => {
    mocks.member.status = "ready";
    mocks.member.sandboxId = "sandbox-1";
    const current = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const workspace = await ensureGen2Instance(mocks.member.id, "user-1", {
      provision: mocks.provision,
      destroy: mocks.destroy,
      current,
    });

    expect(current).toHaveBeenCalledTimes(2);
    expect(mocks.provision).toHaveBeenCalledOnce();
    expect(mocks.updates.map((update) => update.status)).toEqual([
      "provisioning",
      "ready",
    ]);
    expect(workspace.status).toBe("ready");
  });

  it("lets any editor bring the machine up, not just the owner", async () => {
    // Whoever opens the share link first should not have to wait for the
    // owner to press something.
    mocks.member.role = "editor";
    const workspace = await ensureGen2Instance(mocks.member.id, "user-2", {
      provision: mocks.provision,
      destroy: mocks.destroy,
    });
    expect(workspace.status).toBe("ready");
    expect(mocks.provision).toHaveBeenCalledOnce();
  });

  it("waits for another member's provisioning attempt to finish", async () => {
    vi.useFakeTimers();
    mocks.member.status = "provisioning";
    mocks.member.updatedAt = new Date();
    mocks.state.claimed = false;
    let reads = 0;
    mocks.selectQuery.limit.mockImplementation(async () => {
      reads += 1;
      if (reads === 3) {
        mocks.member.status = "ready";
        mocks.member.sandboxId = "sandbox-1";
      }
      return [mocks.member];
    });

    const opening = ensureGen2Instance(mocks.member.id, "user-2", {
      provision: mocks.provision,
      destroy: mocks.destroy,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    const workspace = await opening;

    expect(mocks.provision).not.toHaveBeenCalled();
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(workspace.status).toBe("ready");
  });

  it("does not let an old provisioner overwrite a newer startup lease", async () => {
    const newerLease = new Date(Date.now() + 1_000);
    mocks.provision.mockImplementation(async () => {
      mocks.member.status = "provisioning";
      mocks.member.updatedAt = newerLease;
      mocks.state.leaseCurrent = false;
      return { id: "sandbox-1" };
    });

    await expect(
      ensureGen2Instance(mocks.member.id, "user-1", {
        provision: mocks.provision,
        destroy: mocks.destroy,
      }),
    ).rejects.toMatchObject({
      message: /newer startup attempt took over/,
      status: 503,
    });

    expect(mocks.member.status).toBe("provisioning");
    expect(mocks.member.updatedAt).toBe(newerLease);
    expect(mocks.updates.map((update) => update.status)).toEqual([
      "provisioning",
    ]);
  });

  it("reopens the machine after the owner stops it", async () => {
    mocks.member.status = "ready";
    mocks.member.sandboxId = "sandbox-1";
    const runtime = {
      provision: mocks.provision,
      destroy: mocks.destroy,
    };

    await stopGen2Instance(mocks.member.id, "user-1", runtime);
    const workspace = await ensureGen2Instance(
      mocks.member.id,
      "user-1",
      runtime,
    );

    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.provision).toHaveBeenCalledOnce();
    expect(mocks.updates.map((update) => update.status)).toEqual([
      "stopped",
      "provisioning",
      "ready",
    ]);
    expect(workspace.status).toBe("ready");
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
