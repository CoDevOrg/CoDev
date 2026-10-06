import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const intervals: Array<{ startedAt: Date; endedAt: Date | null }> = [];
  const query = { from: vi.fn(), where: vi.fn() };
  return {
    intervals,
    query,
    isAdmin: vi.fn(async () => false),
    select: vi.fn(() => query),
  };
});

vi.mock("../platform/database", () => ({
  getDatabase: () => ({ select: mocks.select }),
}));
vi.mock("../admin/admin", () => ({ isUserAdmin: mocks.isAdmin }));

vi.mock("../billing/workspace-entitlement", () => ({
  getWorkspaceOwnerEntitlement: vi.fn(async () => ({
    tier: "paid",
    enabled: true,
    unlimited: await mocks.isAdmin(),
    ownedWorkspaceCount: 1,
    usageWindow: "month",
    monthlyLimitMs: (await mocks.isAdmin()) ? null : 40 * 3_600_000,
    workspaceLimit: 1,
    activeWorkspaceLimit: 1,
  })),
}));

import {
  MONTHLY_COMPUTE_LIMIT_MS,
  assertComputeAvailable,
  computeMonth,
  usedComputeMs,
} from "./compute-quota";

describe("monthly VM minute allowance", () => {
  beforeEach(() => {
    mocks.intervals.length = 0;
    mocks.isAdmin.mockResolvedValue(false);
    mocks.query.from.mockReturnValue(mocks.query);
    mocks.query.where.mockImplementation(async () => mocks.intervals);
  });

  it("resets at midnight UTC on the first day of each month", () => {
    const month = computeMonth(new Date("2026-10-31T23:59:59Z"));
    expect(month.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(month.end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("adds concurrent workspaces and charges only time inside the current month", async () => {
    const now = new Date("2026-10-02T01:00:00Z");
    mocks.intervals.push(
      {
        startedAt: new Date("2026-09-30T23:00:00Z"),
        endedAt: new Date("2026-10-01T01:00:00Z"),
      },
      { startedAt: new Date("2026-10-02T00:00:00Z"), endedAt: null },
    );
    expect(await usedComputeMs("owner", now)).toBe(120 * 60_000);
  });

  it("rejects new runtime use at the Individual allowance", async () => {
    const now = new Date("2026-10-10T00:00:00Z");
    mocks.intervals.push({
      startedAt: new Date(now.getTime() - MONTHLY_COMPUTE_LIMIT_MS),
      endedAt: null,
    });
    await expect(assertComputeAvailable("owner", now)).rejects.toMatchObject({
      status: 429,
    });
    mocks.intervals[0]!.startedAt = new Date(
      now.getTime() - MONTHLY_COMPUTE_LIMIT_MS + 1,
    );
    await expect(assertComputeAvailable("owner", now)).resolves.toBeUndefined();
  });

  it("allows application admins past the monthly limit", async () => {
    const now = new Date("2026-10-10T00:00:00Z");
    mocks.isAdmin.mockResolvedValue(true);
    mocks.intervals.push({
      startedAt: new Date(now.getTime() - MONTHLY_COMPUTE_LIMIT_MS),
      endedAt: null,
    });

    await expect(assertComputeAvailable("owner", now)).resolves.toBeUndefined();
  });
});
