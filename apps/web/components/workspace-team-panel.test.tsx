import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ChannelMessage,
  ChannelSummary,
  TeamRoster,
} from "@codev/contracts";

import {
  ChannelConversation,
  TeamRailView,
  describeDispatch,
} from "./workspace-team-panel";

afterEach(cleanup);

const viewerId = "22222222-2222-4222-8222-222222222222";

const roster: TeamRoster = {
  viewerId,
  members: [
    {
      user: {
        id: viewerId,
        login: "jordan",
        name: "Jordan Lee",
        avatarUrl: null,
      },
      accessRole: "owner",
      isViewer: true,
      online: true,
      headline: null,
      emoji: null,
      activePath: null,
      agentTask: null,
      agentProvider: null,
    },
    {
      user: { id: "u2", login: "ada", name: "Ada Lovelace", avatarUrl: null },
      accessRole: "co_steer",
      isViewer: false,
      online: true,
      headline: "Reviewing the auth refactor",
      emoji: "🔍",
      activePath: "apps/web/page.tsx",
      agentTask: null,
      agentProvider: null,
    },
    {
      user: { id: "u3", login: "linus", name: null, avatarUrl: null },
      accessRole: "viewer",
      isViewer: false,
      online: false,
      headline: null,
      emoji: null,
      activePath: null,
      agentTask: null,
      agentProvider: null,
    },
  ],
  agents: [
    {
      sessionId: "s1",
      name: "Agent",
      provider: "anthropic",
      status: "running",
      currentTask: "Fixing the failing presence test",
      owner: "Jordan Lee",
    },
  ],
};

const channels: ChannelSummary[] = [
  {
    id: "c1",
    slug: "general",
    topic: "Everything about this workspace.",
    agentAccess: true,
    messageCount: 3,
    unreadCount: 2,
    lastMessageAt: "2026-08-28T03:00:00.000Z",
    lastMessagePreview: "shipping the migration",
    lastMessageAuthor: "Ada",
  },
  {
    id: "c2",
    slug: "private",
    topic: null,
    agentAccess: false,
    messageCount: 0,
    unreadCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
    lastMessageAuthor: null,
  },
];

function railProps(
  overrides: Partial<Parameters<typeof TeamRailView>[0]> = {},
) {
  return {
    roster,
    channels,
    activeChannelId: null,
    canCreateChannel: true,
    collapsed: false,
    error: null,
    onToggleCollapsed: vi.fn(),
    onSelectChannel: vi.fn(),
    onCreateChannel: vi.fn().mockResolvedValue(null),
    onSaveStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("TeamRailView", () => {
  it("shows each teammate with what they are working on", () => {
    render(<TeamRailView {...railProps()} />);

    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Reviewing the auth refactor")).toBeTruthy();
    // No name on record, so the login stands in.
    expect(screen.getByText("linus")).toBeTruthy();
    expect(screen.getByText("Away")).toBeTruthy();
    expect(screen.getByLabelText("2 here now")).toBeTruthy();
  });

  it("lists running agents alongside the people", () => {
    render(<TeamRailView {...railProps()} />);
    expect(screen.getByText("Fixing the failing presence test")).toBeTruthy();
  });

  it("badges unread channels and opens the one that is clicked", async () => {
    const props = railProps();
    render(<TeamRailView {...props} />);

    expect(screen.getByLabelText("2 unread")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /general/ }));
    expect(props.onSelectChannel).toHaveBeenCalledWith("c1");
  });

  it("lets a member set their own status", async () => {
    const props = railProps();
    render(<TeamRailView {...props} />);

    fireEvent.click(
      screen.getByRole("button", { name: /What are you working on/ }),
    );
    fireEvent.change(screen.getByLabelText("Your status"), {
      target: { value: "Pairing on chat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));

    await waitFor(() =>
      expect(props.onSaveStatus).toHaveBeenCalledWith("Pairing on chat", null),
    );
  });

  it("normalizes a typed channel name before creating it", async () => {
    const props = railProps();
    render(<TeamRailView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /New channel/ }));
    fireEvent.change(screen.getByLabelText("New channel name"), {
      target: { value: "#Release Notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(props.onCreateChannel).toHaveBeenCalledWith("release-notes"),
    );
  });

  it("hides the create form from members who cannot add channels", () => {
    render(<TeamRailView {...railProps({ canCreateChannel: false })} />);
    expect(screen.queryByRole("button", { name: /New channel/ })).toBeNull();
  });

  it("collapses to a rail that still carries the unread count", () => {
    const props = railProps({ collapsed: true });
    render(<TeamRailView {...props} />);

    expect(screen.queryByText("Ada Lovelace")).toBeNull();
    expect(screen.getByText("2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show team panel" }));
    expect(props.onToggleCollapsed).toHaveBeenCalled();
  });
});

function message(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: overrides.id ?? "m1",
    channelId: "c1",
    authorKind: overrides.authorKind ?? "member",
    author:
      overrides.author === undefined
        ? { id: "u2", login: "ada", name: "Ada Lovelace", avatarUrl: null }
        : overrides.author,
    authorLabel: overrides.authorLabel ?? null,
    body: overrides.body ?? "morning",
    mentionsAgent: overrides.mentionsAgent ?? false,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

describe("ChannelConversation", () => {
  function conversationProps(
    overrides: Partial<Parameters<typeof ChannelConversation>[0]> = {},
  ) {
    return {
      channel: channels[0]!,
      messages: [
        message(),
        message({
          id: "m2",
          authorKind: "agent" as const,
          author: null,
          authorLabel: "Agent · anthropic",
          body: "The failing test was a stale fixture; fixed in the worktree.",
        }),
      ],
      notice: null,
      sending: false,
      onClose: vi.fn(),
      onSend: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("renders the transcript with agent posts marked as such", () => {
    render(<ChannelConversation {...conversationProps()} />);

    expect(screen.getByLabelText("#general")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("agent")).toBeTruthy();
    expect(screen.getByText(/Agents read this channel/)).toBeTruthy();
  });

  it("sends on Enter and keeps Shift+Enter for a new line", async () => {
    const props = conversationProps();
    render(<ChannelConversation {...props} />);
    const composer = screen.getByLabelText("Message #general");

    fireEvent.change(composer, { target: { value: "line one" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(props.onSend).not.toHaveBeenCalled();

    fireEvent.change(composer, { target: { value: "line one\nline two" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() =>
      expect(props.onSend).toHaveBeenCalledWith("line one\nline two"),
    );
  });

  it("drops an @agent mention into the draft on request", async () => {
    render(<ChannelConversation {...conversationProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /Ask the agent/ }));
    expect(screen.getByLabelText("Message #general")).toHaveValue("@agent ");
  });

  it("does not send an empty draft", () => {
    const props = conversationProps();
    render(<ChannelConversation {...props} />);

    fireEvent.keyDown(screen.getByLabelText("Message #general"), {
      key: "Enter",
    });
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("closes on Escape so the IDE is one keystroke away", () => {
    const props = conversationProps();
    render(<ChannelConversation {...props} />);

    fireEvent.keyDown(screen.getByLabelText("Message #general"), {
      key: "Escape",
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("shows the empty state for a channel with no history", () => {
    render(<ChannelConversation {...conversationProps({ messages: [] })} />);
    expect(screen.getByText(/This is the start of/)).toBeTruthy();
  });

  it("surfaces the agent hand-off result under the transcript", () => {
    render(
      <ChannelConversation
        {...conversationProps({
          notice: describeDispatch({
            dispatched: false,
            reason: "No agent session is running.",
          }),
        })}
      />,
    );
    expect(screen.getByText(/No agent session is running/)).toBeTruthy();
  });
});

describe("describeDispatch", () => {
  it("says nothing when the message never asked for an agent", () => {
    expect(describeDispatch(null)).toBeNull();
  });

  it("promises a channel reply on a successful hand-off", () => {
    expect(describeDispatch({ dispatched: true, sessionId: "s1" })).toContain(
      "land in this channel",
    );
  });
});
