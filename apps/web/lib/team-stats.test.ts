import { describe, expect, it } from "vitest";

import type { AgentSession } from "@/components/agent-panel";
import { buildTeamStatsSnapshot } from "./team-stats";

function session(
  overrides: Partial<AgentSession> & Pick<AgentSession, "id" | "name">,
): AgentSession {
  return {
    model: "gpt-5.6-luna",
    provider: "cursor",
    status: "idle",
    worktreeName: "wt",
    worktreeStatus: "active",
    issueNumber: null,
    issueTitle: null,
    issueUrl: null,
    reviewHeadSha: null,
    reviewBaseSha: null,
    reviewDiffDigest: null,
    reviewedAt: null,
    mergedAt: null,
    discardedAt: null,
    lastError: null,
    claims: [],
    messages: [],
    turns: [],
    events: [],
    ...overrides,
  };
}

describe("buildTeamStatsSnapshot", () => {
  it("aggregates provider mix, turns, worktrees, and presence", () => {
    const snapshot = buildTeamStatsSnapshot({
      sessions: [
        session({
          id: "1",
          name: "Investigate",
          provider: "cursor",
          status: "running",
          turns: [
            {
              id: "t1",
              prompt: "Check versions",
              status: "completed",
              output: "ok",
              lastError: null,
            },
          ],
          claims: [
            {
              id: "c1",
              pathGlob: "apps/web/**",
              intent: "stats UI",
              status: "active",
            },
          ],
        }),
        session({
          id: "2",
          name: "Merge prep",
          provider: "openai",
          model: "gpt-5",
          status: "completed",
          worktreeStatus: "merged",
          reviewedAt: "2026-08-01T00:00:00.000Z",
          turns: [
            {
              id: "t2",
              prompt: "Summarize",
              status: "completed",
              output: "done",
              lastError: null,
            },
            {
              id: "t3",
              prompt: "Ship",
              status: "completed",
              output: "done",
              lastError: null,
            },
          ],
        }),
      ],
      collaborators: [
        {
          id: "u1",
          name: "Yousef",
          login: "yousef",
          color: "#f00",
          activePath: "apps/web/components/team-stats-panel.tsx",
        },
      ],
      members: [
        {
          userId: "u1",
          login: "yousef",
          name: "Yousef Abdelhadi",
          role: "owner",
          accessRole: "owner",
        },
        {
          userId: "u2",
          login: "teammate",
          name: null,
          role: "member",
          accessRole: "reviewer",
        },
      ],
      currentUser: { id: "u1", name: "Yousef Abdelhadi", login: "yousef" },
      peopleOnline: 1,
    });

    expect(snapshot.activeAgents).toBe(1);
    expect(snapshot.turnCount).toBe(3);
    expect(snapshot.openWorktrees).toBe(1);
    expect(snapshot.mergedWorktrees).toBe(1);
    expect(snapshot.reviewedSessions).toBe(1);
    expect(snapshot.openClaims).toBe(1);
    expect(snapshot.providers.map((bucket) => bucket.label)).toEqual([
      "Codex",
      "Cursor",
    ]);
    expect(snapshot.people[0]?.isYou).toBe(true);
    expect(snapshot.people[0]?.detail).toContain("Editing");
    expect(snapshot.people[1]?.online).toBe(false);
    expect(snapshot.recentSessions[0]?.name).toBe("Merge prep");
  });
});
