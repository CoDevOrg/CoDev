import { describe, expect, it } from "vitest";

import {
  toCoordinationSnapshot,
  type CoordinationSessionSource,
} from "./coordination-snapshot";

function session(
  overrides: Partial<CoordinationSessionSource> & { id: string },
): CoordinationSessionSource {
  return {
    name: "claude · codev/alice-aaaa",
    provider: "anthropic",
    kind: "cli",
    worktreeId: `wt-${overrides.id}`,
    worktreeName: "codev/alice-aaaa",
    ownerName: "Alex Morgan",
    ...overrides,
  };
}

const EXPIRES = new Date("2026-09-01T12:00:00.000Z");

describe("toCoordinationSnapshot", () => {
  it("names the agent and branch behind every live claim", () => {
    const snapshot = toCoordinationSnapshot({
      sessions: [session({ id: "s1" })],
      claims: [
        {
          id: "c1",
          sessionId: "s1",
          pathGlob: "apps/web/lib/auth.ts",
          intent: "rewriting the cookie parser",
          status: "active",
          expiresAt: EXPIRES,
        },
      ],
      overlaps: [],
    });

    expect(snapshot.claims).toEqual([
      {
        id: "c1",
        sessionId: "s1",
        worktreeId: "wt-s1",
        branch: "codev/alice-aaaa",
        agentLabel: "claude · codev/alice-aaaa",
        ownerName: "Alex Morgan",
        path: "apps/web/lib/auth.ts",
        intent: "rewriting the cookie parser",
        status: "active",
        expiresAt: EXPIRES.toISOString(),
        createdAt: EXPIRES.toISOString(),
      },
    ]);
  });

  it("drops released claims, which hold nothing", () => {
    const snapshot = toCoordinationSnapshot({
      sessions: [session({ id: "s1" })],
      claims: [
        {
          id: "c1",
          sessionId: "s1",
          pathGlob: "a.ts",
          intent: "done with it",
          status: "released",
          expiresAt: EXPIRES,
        },
      ],
      overlaps: [],
    });
    expect(snapshot.claims).toEqual([]);
    expect(snapshot.contests).toEqual([]);
  });

  /**
   * The write path marks claims contested with `claimPatternsOverlap`, so a
   * `dir/**` glob and a file inside it are a real, recorded collision. Grouping
   * contests by exact path string hid exactly those.
   */
  it("reports a glob colliding with a file beneath it", () => {
    const snapshot = toCoordinationSnapshot({
      sessions: [
        session({ id: "s1", name: "alice-agent" }),
        session({ id: "s2", name: "bob-agent" }),
      ],
      claims: [
        {
          id: "c1",
          sessionId: "s1",
          pathGlob: "apps/web/**",
          intent: "sweeping refactor",
          status: "contested",
          expiresAt: EXPIRES,
        },
        {
          id: "c2",
          sessionId: "s2",
          pathGlob: "apps/web/lib/auth.ts",
          intent: "one file",
          status: "contested",
          expiresAt: EXPIRES,
        },
      ],
      overlaps: [],
    });

    expect(snapshot.contests).toHaveLength(1);
    expect(snapshot.contests[0]?.paths).toEqual([
      "apps/web/**",
      "apps/web/lib/auth.ts",
    ]);
    expect(
      snapshot.contests[0]?.holders.map((holder) => [
        holder.agentLabel,
        holder.paths,
      ]),
    ).toEqual([
      ["alice-agent", ["apps/web/**"]],
      ["bob-agent", ["apps/web/lib/auth.ts"]],
    ]);
  });

  /** A glob pulls in two files that do not overlap each other; all three
   *  sessions are one collision, not two. */
  it("groups a collision transitively through the widest claim", () => {
    const snapshot = toCoordinationSnapshot({
      sessions: [
        session({ id: "s1", name: "a" }),
        session({ id: "s2", name: "b" }),
        session({ id: "s3", name: "c" }),
      ],
      claims: [
        {
          id: "c1",
          sessionId: "s1",
          pathGlob: "apps/**",
          intent: "wide",
          status: "contested",
          expiresAt: EXPIRES,
        },
        {
          id: "c2",
          sessionId: "s2",
          pathGlob: "apps/web/a.ts",
          intent: "narrow",
          status: "contested",
          expiresAt: EXPIRES,
        },
        {
          id: "c3",
          sessionId: "s3",
          pathGlob: "apps/web/b.ts",
          intent: "narrow",
          status: "contested",
          expiresAt: EXPIRES,
        },
      ],
      overlaps: [],
    });

    expect(snapshot.contests).toHaveLength(1);
    expect(snapshot.contests[0]?.holders).toHaveLength(3);
  });

  it("leaves unrelated claims out of each other's collisions", () => {
    const snapshot = toCoordinationSnapshot({
      sessions: [
        session({ id: "s1", name: "a" }),
        session({ id: "s2", name: "b" }),
      ],
      claims: [
        {
          id: "c1",
          sessionId: "s1",
          pathGlob: "apps/web/**",
          intent: "web",
          status: "active",
          expiresAt: EXPIRES,
        },
        {
          id: "c2",
          sessionId: "s2",
          pathGlob: "services/orchestrator/src/main.rs",
          intent: "rust",
          status: "active",
          expiresAt: EXPIRES,
        },
      ],
      overlaps: [],
    });
    expect(snapshot.contests).toEqual([]);
  });

  it("reports a contest only when two different sessions hold one path", () => {
    const snapshot = toCoordinationSnapshot({
      sessions: [
        session({ id: "s1", name: "claude · codev/alice" }),
        session({ id: "s2", name: "codex · codev/bob" }),
      ],
      claims: [
        {
          id: "c1",
          sessionId: "s1",
          pathGlob: "apps/web/lib/auth.ts",
          intent: "parser",
          status: "contested",
          expiresAt: EXPIRES,
        },
        {
          id: "c2",
          sessionId: "s2",
          pathGlob: "apps/web/lib/auth.ts",
          intent: "refresh",
          status: "contested",
          expiresAt: EXPIRES,
        },
      ],
      overlaps: [],
    });

    expect(snapshot.contests).toEqual([
      {
        paths: ["apps/web/lib/auth.ts"],
        holders: [
          {
            sessionId: "s1",
            agentLabel: "claude · codev/alice",
            paths: ["apps/web/lib/auth.ts"],
          },
          {
            sessionId: "s2",
            agentLabel: "codex · codev/bob",
            paths: ["apps/web/lib/auth.ts"],
          },
        ],
      },
    ]);
  });

  it("does not call one agent's two claims on a path a collision", () => {
    const snapshot = toCoordinationSnapshot({
      sessions: [session({ id: "s1" })],
      claims: [
        {
          id: "c1",
          sessionId: "s1",
          pathGlob: "apps/web/lib/auth.ts",
          intent: "first",
          status: "active",
          expiresAt: EXPIRES,
        },
        {
          id: "c2",
          sessionId: "s1",
          pathGlob: "apps/web/lib/auth.ts",
          intent: "second",
          status: "active",
          expiresAt: EXPIRES,
        },
      ],
      overlaps: [],
    });
    expect(snapshot.contests).toEqual([]);
  });

  /**
   * A claim whose session row has gone (a worktree discarded mid-poll) still
   * has to render — dropping it would quietly under-report what is held.
   */
  it("keeps a claim whose session it cannot resolve", () => {
    const snapshot = toCoordinationSnapshot({
      sessions: [],
      claims: [
        {
          id: "c1",
          sessionId: "ghost",
          pathGlob: "a.ts",
          intent: "?",
          status: "active",
          expiresAt: EXPIRES,
        },
      ],
      overlaps: [],
    });
    expect(snapshot.claims).toHaveLength(1);
    expect(snapshot.claims[0]).toMatchObject({
      agentLabel: "An agent",
      ownerName: "Someone",
      branch: null,
    });
  });

  it("resolves both sides of a brain overlap", () => {
    const snapshot = toCoordinationSnapshot({
      sessions: [
        session({
          id: "s1",
          name: "claude · codev/alice",
          worktreeName: "codev/alice",
        }),
        session({
          id: "s2",
          name: "codex · codev/bob",
          worktreeName: "codev/bob",
        }),
      ],
      claims: [],
      overlaps: [
        {
          id: "o1",
          leftSessionId: "s1",
          rightSessionId: "s2",
          kind: "same_files",
          score: 82,
          rationale: "Both briefs name apps/web/lib/auth.ts.",
        },
      ],
    });

    expect(snapshot.overlaps).toEqual([
      {
        id: "o1",
        sessionIds: ["s1", "s2"],
        branches: ["codev/alice", "codev/bob"],
        agentLabels: ["claude · codev/alice", "codex · codev/bob"],
        kind: "same_files",
        score: 82,
        rationale: "Both briefs name apps/web/lib/auth.ts.",
        detectedAt: new Date(0).toISOString(),
      },
    ]);
  });

  it("summarizes coordination messages without exposing the full payload", () => {
    const createdAt = new Date("2026-09-01T11:58:00.000Z");
    const snapshot = toCoordinationSnapshot({
      sessions: [
        session({ id: "s1", name: "Codex" }),
        session({ id: "s2", name: "Claude" }),
      ],
      claims: [],
      overlaps: [],
      messages: [
        {
          id: "m1",
          fromSessionId: "s1",
          toSessionId: "s2",
          kind: "claim_request",
          payload: {
            path: "apps/web/lib/auth.ts",
            intent:
              "Coordinate the authentication parser before either agent edits it.",
            privateField: "must not be copied",
          },
          status: "delivered",
          createdAt,
        },
      ],
    });

    expect(snapshot.messages).toEqual([
      expect.objectContaining({
        summary:
          "Codex asked Claude to coordinate work on apps/web/lib/auth.ts",
        detail:
          "Coordinate the authentication parser before either agent edits it.",
        status: "delivered",
        createdAt: createdAt.toISOString(),
      }),
    ]);
    expect(JSON.stringify(snapshot.messages)).not.toContain("privateField");
    expect(JSON.stringify(snapshot.messages)).not.toContain(
      "must not be copied",
    );
  });

  it("uses deterministic handoff copy and caps the displayed detail", () => {
    const snapshot = toCoordinationSnapshot({
      sessions: [
        session({ id: "s1", name: "Codex" }),
        session({ id: "s2", name: "Claude" }),
      ],
      claims: [],
      overlaps: [],
      messages: [
        {
          id: "m2",
          fromSessionId: "s1",
          toSessionId: "s2",
          kind: "handoff",
          payload: { paths: ["a.ts", "b.ts"], summary: "x".repeat(200) },
          status: "resolved",
          createdAt: EXPIRES,
        },
      ],
    });

    expect(snapshot.messages[0]?.summary).toBe(
      "Codex handed 2 files to Claude",
    );
    expect(snapshot.messages[0]?.detail).toHaveLength(120);
    expect(snapshot.messages[0]?.detail?.endsWith("…")).toBe(true);
  });
});
