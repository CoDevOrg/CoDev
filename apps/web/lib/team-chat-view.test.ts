import { describe, expect, it } from "vitest";

import type { ChannelMessage } from "@codev/contracts";

import {
  authorNameFor,
  describeMemberFocus,
  formatChatTime,
  formatTeamChatDigest,
  groupChannelMessages,
  mergeTeamRoster,
} from "./team-chat-view";

function member(
  overrides: Partial<{ id: string; login: string; name: string | null }> = {},
) {
  return {
    user: {
      id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
      login: overrides.login ?? "ada",
      name: overrides.name ?? "Ada Lovelace",
      avatarUrl: null,
    },
    accessRole: "co_steer",
    headline: null,
    emoji: null,
  };
}

function message(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: overrides.id ?? "m1",
    channelId: "c1",
    authorKind: overrides.authorKind ?? "member",
    author:
      overrides.author === undefined
        ? {
            id: "u1",
            login: "ada",
            name: "Ada Lovelace",
            avatarUrl: null,
          }
        : overrides.author,
    authorLabel: overrides.authorLabel ?? null,
    body: overrides.body ?? "hello",
    mentionsAgent: overrides.mentionsAgent ?? false,
    createdAt: overrides.createdAt ?? "2026-08-28T03:00:00.000Z",
  };
}

describe("mergeTeamRoster", () => {
  const viewerId = "22222222-2222-4222-8222-222222222222";

  it("keeps every member listed even when presence has lapsed", () => {
    const roster = mergeTeamRoster({
      viewerId,
      members: [
        member(),
        member({ id: viewerId, login: "grace", name: "Grace" }),
      ],
      presence: [],
      agents: [],
    });

    expect(roster.members).toHaveLength(2);
    expect(roster.members.every((entry) => entry.online)).toBe(false);
  });

  it("decorates a member with their live file and their agent's task", () => {
    const roster = mergeTeamRoster({
      viewerId,
      members: [member()],
      presence: [
        {
          userId: "11111111-1111-4111-8111-111111111111",
          path: "apps/web/page.tsx",
        },
      ],
      agents: [
        {
          sessionId: "s1",
          name: "Agent",
          provider: "anthropic",
          status: "running",
          currentTask: "Refactor the auth guard",
          ownerId: "11111111-1111-4111-8111-111111111111",
          owner: "Ada Lovelace",
        },
      ],
    });

    const [entry] = roster.members;
    expect(entry?.online).toBe(true);
    expect(entry?.activePath).toBe("apps/web/page.tsx");
    expect(entry?.agentTask).toBe("Refactor the auth guard");
    expect(entry?.agentProvider).toBe("anthropic");
  });

  it("sorts people who are here above people who are not", () => {
    const away = member({
      id: "33333333-3333-4333-8333-333333333333",
      login: "away",
      name: "Away",
    });
    const here = member({
      id: "44444444-4444-4444-8444-444444444444",
      login: "here",
      name: "Here",
    });
    const roster = mergeTeamRoster({
      viewerId,
      members: [away, here],
      presence: [{ userId: here.user.id, path: null }],
      agents: [],
    });

    expect(roster.members.map((entry) => entry.user.login)).toEqual([
      "here",
      "away",
    ]);
  });

  it("marks the viewer so the UI can show their own status card", () => {
    const roster = mergeTeamRoster({
      viewerId,
      members: [member({ id: viewerId })],
      presence: [],
      agents: [],
    });
    expect(roster.members[0]?.isViewer).toBe(true);
  });
});

describe("describeMemberFocus", () => {
  const base = {
    user: { id: "u1", login: "ada", name: "Ada", avatarUrl: null },
    accessRole: "owner",
    isViewer: false,
    online: true,
    headline: null,
    emoji: null,
    activePath: null,
    agentTask: null,
    agentProvider: null,
  };

  it("prefers what the member said about themselves", () => {
    expect(
      describeMemberFocus({
        ...base,
        headline: "Reviewing the migration",
        agentTask: "Running tests",
        activePath: "a.ts",
      }),
    ).toEqual({ text: "Reviewing the migration", kind: "headline" });
  });

  it("falls back to the agent task, then the open file, then presence", () => {
    expect(
      describeMemberFocus({
        ...base,
        agentTask: "Running tests",
        activePath: "a.ts",
      }).kind,
    ).toBe("agent");
    expect(describeMemberFocus({ ...base, activePath: "a.ts" }).kind).toBe(
      "file",
    );
    expect(describeMemberFocus(base).text).toBe("In the workspace");
    expect(describeMemberFocus({ ...base, online: false }).text).toBe("Away");
  });
});

describe("groupChannelMessages", () => {
  it("folds a burst from one author into a single block", () => {
    const groups = groupChannelMessages([
      message({ id: "a", createdAt: "2026-08-28T03:00:00.000Z" }),
      message({ id: "b", createdAt: "2026-08-28T03:01:00.000Z" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.messages.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("starts a new block after a long pause or a different author", () => {
    const groups = groupChannelMessages([
      message({ id: "a", createdAt: "2026-08-28T03:00:00.000Z" }),
      message({ id: "b", createdAt: "2026-08-28T03:30:00.000Z" }),
      message({
        id: "c",
        createdAt: "2026-08-28T03:31:00.000Z",
        authorKind: "agent",
        author: null,
        authorLabel: "Agent · anthropic",
      }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["a", "b", "c"]);
    expect(groups[2]?.authorName).toBe("Agent · anthropic");
  });
});

describe("authorNameFor", () => {
  it("names agent and system posts without a user row", () => {
    expect(
      authorNameFor(
        message({ authorKind: "agent", author: null, authorLabel: null }),
      ),
    ).toBe("Agent");
    expect(
      authorNameFor(
        message({ authorKind: "system", author: null, authorLabel: null }),
      ),
    ).toBe("CoDev");
  });
});

describe("formatChatTime", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");

  it("reads as a chat timestamp, not a duration", () => {
    expect(formatChatTime("2026-08-28T11:59:40.000Z", now)).toBe("now");
    expect(formatChatTime("2026-08-28T11:50:00.000Z", now)).toBe("10m");
    expect(formatChatTime("2026-08-28T09:00:00.000Z", now)).toBe("3h");
    expect(formatChatTime("2026-08-26T12:00:00.000Z", now)).toBe("2d");
  });

  it("returns nothing for an unparseable timestamp", () => {
    expect(formatChatTime("not a date", now)).toBe("");
  });
});

describe("formatTeamChatDigest", () => {
  it("renders channels an agent can quote back", () => {
    const digest = formatTeamChatDigest([
      {
        slug: "general",
        topic: "Everything",
        messages: [
          {
            author: "Ada",
            body: "ship the migration first",
            createdAt: "2026-08-28T03:00:00.000Z",
          },
        ],
      },
      { slug: "empty", topic: null, messages: [] },
    ]);

    expect(digest).toContain("#general — Everything");
    expect(digest).toContain("Ada: ship the migration first");
    expect(digest).not.toContain("#empty");
  });

  it("says so plainly when there is nothing to read", () => {
    expect(formatTeamChatDigest([])).toBe("No team chat messages yet.");
  });
});
