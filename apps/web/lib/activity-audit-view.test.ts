import { describe, expect, it } from "vitest";

import {
  activityJumpFor,
  activityRestoreRevision,
  filterActivityEvents,
  toActivitySnapshot,
} from "./activity-audit-view";

const createdAt = "2026-08-15T19:28:00.000Z";

describe("activity audit view", () => {
  it("maps durable events to jump targets for files, sessions, and diffs", () => {
    const snapshot = toActivitySnapshot({
      actors: {
        "user-jordan": "CoDev Test Jordan",
        "user-alex": "Alex Morgan",
      },
      events: [
        {
          id: "event-merge",
          sequence: 12,
          type: "agent.review_merged",
          actorId: "user-jordan",
          payload: {
            sessionId: "session-3",
            reviewDiffDigest: "sha256:abc",
          },
          createdAt,
        },
        {
          id: "event-file",
          sequence: 11,
          type: "presence.active_file.changed",
          actorId: "user-alex",
          payload: {
            userId: "user-alex",
            path: "README.md",
            previousPath: null,
          },
          createdAt,
        },
        {
          id: "event-queue",
          sequence: 10,
          type: "shared_session.turn.queued",
          actorId: "user-alex",
          payload: { sessionId: "session-1", prompt: "Inspect README.md" },
          createdAt,
        },
        {
          id: "event-cursor",
          sequence: 9,
          type: "presence.cursor.changed",
          actorId: "user-alex",
          payload: { path: "README.md", cursor: { anchor: 0, head: 4 } },
          createdAt,
        },
      ],
    });

    expect(snapshot.events.map((event) => event.type)).toEqual([
      "agent.review_merged",
      "presence.active_file.changed",
      "shared_session.turn.queued",
    ]);
    expect(snapshot.events[0]).toMatchObject({
      actor: "CoDev Test Jordan",
      summary: "CoDev Test Jordan integrated a reviewed checkpoint",
      jump: {
        kind: "diff",
        surface: "checks",
        label: "Open Checks · diff",
        sessionId: "session-3",
      },
    });
    expect(snapshot.events[1]).toMatchObject({
      actor: "Alex Morgan",
      summary: "Alex Morgan opened README.md",
      jump: {
        kind: "file",
        surface: "explorer",
        label: "Open Explorer · README.md",
        path: "README.md",
      },
    });
    expect(snapshot.events[2]?.jump).toMatchObject({
      kind: "session",
      surface: "vault",
      label: "Open Agents · session",
      sessionId: "session-1",
    });
  });

  it("filters the timeline by jump kind and query, then keeps the matching jump", () => {
    const snapshot = toActivitySnapshot({
      actors: { "user-jordan": "CoDev Test Jordan" },
      filter: { kind: "diff", query: "review_merged" },
      events: [
        {
          id: "event-merge",
          sequence: 2,
          type: "agent.review_merged",
          actorId: "user-jordan",
          payload: { sessionId: "session-3" },
          createdAt,
        },
        {
          id: "event-file",
          sequence: 1,
          type: "presence.active_file.changed",
          actorId: "user-jordan",
          payload: { path: "oi10-review.txt" },
          createdAt,
        },
      ],
    });

    expect(snapshot.filtered).toHaveLength(1);
    expect(snapshot.filtered[0]).toMatchObject({
      type: "agent.review_merged",
      jump: { surface: "checks" },
    });
    expect(
      filterActivityEvents(snapshot.events, { kind: "file", query: "oi10" })[0]
        ?.path,
    ).toBe("oi10-review.txt");
    expect(
      activityJumpFor("agent.review_discarded", { sessionId: "s1" })?.kind,
    ).toBe("diff");
  });

  it("only exposes a restore revision for a merged review's pre-merge sha", () => {
    expect(
      activityRestoreRevision("agent.review_merged", {
        reviewBaseSha: "a".repeat(40),
      }),
    ).toBe("a".repeat(40));
    expect(activityRestoreRevision("agent.review_merged", {})).toBeNull();
    expect(
      activityRestoreRevision("agent.review_discarded", {
        reviewBaseSha: "a".repeat(40),
      }),
    ).toBeNull();
  });
});
