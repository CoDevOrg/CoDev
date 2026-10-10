import { describe, expect, it } from "vitest";
import type { CollaborationPresenceEntry } from "@codev/contracts";

import { presenceByPath, summarizePresence } from "./use-workspace-presence";

const user = (id: string, name: string) => ({
  id,
  login: name.toLowerCase(),
  name,
  avatarUrl: null,
});
const ALEX = "a010bd2c-a3c1-438f-acef-166287a3b1cb";
const SAM = "b010bd2c-a3c1-438f-acef-166287a3b1cb";

function entry(
  overrides: Partial<CollaborationPresenceEntry> & { connectionId: string },
): CollaborationPresenceEntry {
  return {
    user: user(ALEX, "Alex"),
    path: null,
    cursor: null,
    worktreeId: "main",
    agent: null,
    view: "chat",
    chatId: null,
    away: false,
    lastSeenAt: "2026-07-28T12:00:00.000Z",
    ...overrides,
  };
}

describe("summarizePresence", () => {
  it("shows one person per member, from their most recent visible tab", () => {
    const { people } = summarizePresence({
      presence: [
        entry({
          connectionId: "old",
          path: "a.ts",
          lastSeenAt: "2026-07-28T11:00:00.000Z",
        }),
        entry({
          connectionId: "hidden",
          away: true,
          lastSeenAt: "2026-07-28T13:00:00.000Z",
        }),
        entry({
          connectionId: "new",
          path: "b.ts",
          lastSeenAt: "2026-07-28T12:30:00.000Z",
        }),
        entry({ connectionId: "sam", user: user(SAM, "Sam") }),
      ],
      members: [{ userId: SAM, login: "sam", name: "Sam", role: "viewer" }],
      meId: SAM,
    });
    expect(people).toHaveLength(2);
    expect(people.find((p) => p.userId === ALEX)).toMatchObject({
      path: "b.ts",
      away: false,
    });
    expect(people.find((p) => p.userId === SAM)).toMatchObject({
      isSelf: true,
      role: "viewer",
    });
  });

  it("lists running agents apart from people and places them in files", () => {
    const presence = [
      entry({
        connectionId: "agent:s1",
        path: "src/app.ts",
        agent: { sessionId: "s1", provider: "claude", chatId: ALEX },
      }),
      entry({ connectionId: "me", user: user(SAM, "Sam"), path: "src/app.ts" }),
    ];
    const summary = summarizePresence({ presence, members: [], meId: SAM });
    expect(summary.agents).toEqual([
      expect.objectContaining({ sessionId: "s1", owner: user(ALEX, "Alex") }),
    ]);
    const files = presenceByPath(presence, "main", "me", summary.people);
    expect(files.get("src/app.ts")).toEqual([
      expect.objectContaining({ kind: "agent", id: "s1" }),
    ]);
    expect(presenceByPath(presence, "feature", "me", summary.people).size).toBe(
      0,
    );
  });
});
