import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.hoisted(() => vi.fn());
const mockListWorkspaceMembers = vi.hoisted(() => vi.fn());

vi.mock("./database", () => ({
  getDatabase: () => ({ select: mockSelect }),
}));
vi.mock("./workspaces", () => ({
  listWorkspaceMembers: mockListWorkspaceMembers,
}));
vi.mock("./orchestrator", () => ({
  OrchestratorError: class OrchestratorError extends Error {},
  getIde: vi.fn(),
}));
vi.mock("./vm-usage", () => ({
  openSandboxInterval: vi.fn(),
  closeSandboxInterval: vi.fn(),
}));

import {
  MONTHLY_MINUTES_PER_MEMBER,
  getWorkspaceCreditStatus,
} from "./compute-credits";

function intervalsSelect(rows: unknown[]) {
  return { from: () => ({ where: async () => rows }) };
}

function member(userId: string) {
  return { userId } as ReturnType<typeof mockListWorkspaceMembers>;
}

describe("getWorkspaceCreditStatus", () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockListWorkspaceMembers.mockReset();
  });

  it("pools the allotment across every workspace member", async () => {
    mockListWorkspaceMembers.mockResolvedValue([
      member("user-1"),
      member("user-2"),
      member("user-3"),
    ]);
    mockSelect.mockReturnValue(intervalsSelect([]));

    const status = await getWorkspaceCreditStatus("workspace-1");

    expect(status.allottedMinutes).toBe(3 * MONTHLY_MINUTES_PER_MEMBER);
    expect(status.usedMinutes).toBe(0);
    expect(status.remainingMinutes).toBe(3 * MONTHLY_MINUTES_PER_MEMBER);
  });

  it("counts live elapsed time on a still-open interval", async () => {
    mockListWorkspaceMembers.mockResolvedValue([member("user-1")]);
    const startedAt = new Date(Date.now() - 5 * 60_000);
    mockSelect.mockReturnValue(
      intervalsSelect([{ startedAt, endedAt: null }]),
    );

    const status = await getWorkspaceCreditStatus("workspace-1");

    expect(status.usedMinutes).toBeGreaterThanOrEqual(5);
    expect(status.usedMinutes).toBeLessThan(7);
  });

  it("clips a closed interval that started before this calendar month", async () => {
    mockListWorkspaceMembers.mockResolvedValue([member("user-1")]);
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const startedLastMonth = new Date(monthStart.getTime() - 10 * 60_000);
    const endedTenMinutesIntoMonth = new Date(
      monthStart.getTime() + 10 * 60_000,
    );
    mockSelect.mockReturnValue(
      intervalsSelect([
        { startedAt: startedLastMonth, endedAt: endedTenMinutesIntoMonth },
      ]),
    );

    const status = await getWorkspaceCreditStatus("workspace-1");

    // Only the 10 minutes inside the current month should count, not the
    // full 20-minute interval spanning back into last month.
    expect(status.usedMinutes).toBe(10);
  });

  it("caps remainingMinutes at zero once usage exceeds the allotment", async () => {
    mockListWorkspaceMembers.mockResolvedValue([member("user-1")]);
    const startedAt = new Date(
      Date.now() - (MONTHLY_MINUTES_PER_MEMBER + 100) * 60_000,
    );
    mockSelect.mockReturnValue(
      intervalsSelect([{ startedAt, endedAt: null }]),
    );

    const status = await getWorkspaceCreditStatus("workspace-1");

    expect(status.remainingMinutes).toBe(0);
  });
});
