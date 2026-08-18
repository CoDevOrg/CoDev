import { describe, expect, it } from "vitest";

import { AGENT_CAPACITY_EXCEEDED_MESSAGE } from "./agent-capacity";
import {
  FOURTH_SESSION_REJECTION_TITLE,
  formatElapsed,
  toWorkboardSlots,
  workboardRejection,
  type WorkboardSession,
} from "./workboard-view";

const now = new Date("2026-08-15T08:00:00.000Z");

function session(
  overrides: Partial<WorkboardSession> & Pick<WorkboardSession, "id">,
): WorkboardSession {
  return {
    name: "Managed proposal",
    provider: "openai",
    status: "idle",
    worktreeId: `worktree-${overrides.id}`,
    worktreeName: `agent-managed-proposal-${overrides.id.slice(0, 8)}`,
    worktreeStatus: "active",
    ownerName: "CoDev Test Jordan",
    ownerLogin: "jordan",
    issueTitle: null,
    createdAt: "2026-08-15T07:59:42.000Z",
    turns: [],
    ...overrides,
  };
}

describe("workboard view", () => {
  it("always renders three slots with assignment, owner, provider, status, worktree, task, and elapsed time", () => {
    const { capacity, slots } = toWorkboardSlots(
      [
        session({
          id: "session-1",
          name: "Repository map",
          ownerName: "Alex Morgan",
          provider: "openai",
          createdAt: "2026-08-15T07:59:42.000Z",
          turns: [
            { prompt: "Map the repository layout.", status: "completed" },
          ],
        }),
        session({
          id: "session-2",
          name: "Presence replay",
          ownerName: "Jordan Lee",
          provider: "anthropic",
          createdAt: "2026-08-15T07:58:18.000Z",
          turns: [{ prompt: "Replay presence.", status: "running" }],
        }),
      ],
      now,
    );

    expect(capacity).toEqual({
      maxActiveSessions: 3,
      activeSessions: 2,
      availableSlots: 1,
    });
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({
      slot: 1,
      occupied: true,
      assignment: "Repository map",
      owner: "Alex Morgan",
      provider: "openai",
      status: "Active",
      worktree: "agent-managed-proposal-session-",
      currentTask: "Map the repository layout.",
      elapsed: "00:18",
    });
    expect(slots[0]?.worktree).toBe("agent-managed-proposal-session-");
    expect(slots[1]).toMatchObject({
      slot: 2,
      assignment: "Presence replay",
      owner: "Jordan Lee",
      provider: "anthropic",
      elapsed: "01:42",
    });
    expect(slots[2]).toMatchObject({
      slot: 3,
      occupied: false,
      assignment: "Available",
      owner: "Unassigned",
      status: "Available",
      elapsed: "00:00",
    });
  });

  it("fills all three slots and exposes the fourth-session rejection copy", () => {
    const { capacity, slots } = toWorkboardSlots(
      [
        session({ id: "session-1" }),
        session({ id: "session-2", worktreeStatus: "frozen", status: "idle" }),
        session({ id: "session-3", status: "interrupted" }),
        session({ id: "session-4", worktreeStatus: "discarded" }),
      ],
      now,
    );

    expect(capacity.availableSlots).toBe(0);
    expect(slots.map((slot) => slot.occupied)).toEqual([true, true, true]);
    expect(slots[1]?.status).toBe("Frozen");
    expect(slots[2]?.status).toBe("Interrupted");
    expect(workboardRejection()).toEqual({
      status: 409,
      title: FOURTH_SESSION_REJECTION_TITLE,
      message: AGENT_CAPACITY_EXCEEDED_MESSAGE,
    });
  });

  it("formats elapsed time past one hour", () => {
    expect(formatElapsed("2026-08-15T05:00:00.000Z", now)).toBe("3:00:00");
  });
});
