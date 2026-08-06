import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.hoisted(() => vi.fn());

vi.mock("./database", () => ({
  getDatabase: () => ({
    select: mockSelect,
    insert: vi.fn(),
    transaction: vi.fn(),
  }),
}));

import { assertVmMinuteQuota } from "./quotas";
import { getVmMinutesUsed, VM_MINUTE_LIFETIME_QUOTA } from "./vm-usage";

function usageSelect(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

function openIntervalSelect(rows: unknown[]) {
  return {
    from: () => ({
      where: async () => rows,
    }),
  };
}

describe("VM minute quota", () => {
  beforeEach(() => {
    mockSelect.mockReset();
  });

  it("sums stored minutes and open intervals", async () => {
    mockSelect
      .mockImplementationOnce(() => usageSelect([{ minutesUsed: 1_990 }]))
      .mockImplementationOnce(() =>
        openIntervalSelect([{ startedAt: new Date(Date.now() - 90_000) }]),
      );

    await expect(getVmMinutesUsed("user-1")).resolves.toBeGreaterThanOrEqual(
      1_992,
    );
  });

  it("rejects starts when the lifetime allotment is exhausted", async () => {
    mockSelect
      .mockImplementationOnce(() =>
        usageSelect([{ minutesUsed: VM_MINUTE_LIFETIME_QUOTA }]),
      )
      .mockImplementationOnce(() => openIntervalSelect([]));

    await expect(assertVmMinuteQuota("user-1")).rejects.toMatchObject({
      name: "QuotaError",
      code: "vm_minute_quota",
    });
  });
});
