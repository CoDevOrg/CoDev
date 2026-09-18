import type {
  ChannelMessage,
  TeamMemberPresence,
  TeamRoster,
} from "@codev/contracts";

export const TEAM_CHAT_POLL_MS = 5_000;
/** An open conversation refreshes faster than the roster beside it. */
export const CHANNEL_MESSAGE_POLL_MS = 3_000;

/** Consecutive posts by one author inside this window render as one block. */
const MESSAGE_GROUP_WINDOW_MS = 5 * 60_000;

export type RosterMemberRow = {
  user: {
    id: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
  };
  accessRole: string;
  headline: string | null;
  emoji: string | null;
};

export type RosterPresenceRow = {
  userId: string;
  path: string | null;
};

export type RosterAgentRow = {
  sessionId: string;
  name: string;
  provider: string;
  status: string;
  currentTask: string;
  ownerId: string | null;
  owner: string;
};

/**
 * Builds the people list. Membership is the source of truth for who belongs
 * here; presence and agent state only decorate those rows, so a member never
 * disappears from the list just because their heartbeat lapsed.
 */
export function mergeTeamRoster(input: {
  viewerId: string;
  members: RosterMemberRow[];
  presence: RosterPresenceRow[];
  agents: RosterAgentRow[];
}): TeamRoster {
  const presenceByUser = new Map(
    input.presence.map((entry) => [entry.userId, entry]),
  );
  const agentByOwner = new Map<string, RosterAgentRow>();
  for (const agent of input.agents) {
    if (agent.ownerId && !agentByOwner.has(agent.ownerId)) {
      agentByOwner.set(agent.ownerId, agent);
    }
  }

  const members: TeamMemberPresence[] = input.members.map((member) => {
    const presence = presenceByUser.get(member.user.id);
    const agent = agentByOwner.get(member.user.id);
    return {
      user: member.user,
      accessRole: member.accessRole,
      isViewer: member.user.id === input.viewerId,
      online: Boolean(presence),
      headline: member.headline,
      emoji: member.emoji,
      activePath: presence?.path ?? null,
      agentTask: agent?.currentTask ?? null,
      agentProvider: agent?.provider ?? null,
    };
  });

  // Online first, then the viewer, then alphabetically — the list should read
  // as "who can answer me right now".
  members.sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1;
    if (left.isViewer !== right.isViewer) return left.isViewer ? -1 : 1;
    return displayName(left).localeCompare(displayName(right));
  });

  return {
    viewerId: input.viewerId,
    members,
    agents: input.agents.map((agent) => ({
      sessionId: agent.sessionId,
      name: agent.name,
      provider: agent.provider,
      status: agent.status,
      currentTask: agent.currentTask,
      owner: agent.owner,
    })),
  };
}

export function displayName(member: {
  user: { login: string; name: string | null };
}) {
  return member.user.name?.trim() || member.user.login;
}

/**
 * The single most specific true thing we can say about a teammate, in
 * descending order of intent: what they said they're doing, what their agent
 * is doing, the file they're in, then simple availability.
 */
export function describeMemberFocus(member: TeamMemberPresence) {
  if (member.headline?.trim()) {
    return { text: member.headline.trim(), kind: "headline" as const };
  }
  if (member.agentTask?.trim()) {
    return { text: member.agentTask.trim(), kind: "agent" as const };
  }
  if (member.activePath) {
    return { text: member.activePath, kind: "file" as const };
  }
  return {
    text: member.online ? "In the workspace" : "Away",
    kind: "idle" as const,
  };
}

export type ChannelMessageGroup = {
  key: string;
  authorKey: string;
  authorKind: ChannelMessage["authorKind"];
  authorName: string;
  avatarUrl: string | null;
  createdAt: string;
  messages: ChannelMessage[];
};

export function authorNameFor(message: ChannelMessage) {
  if (message.author) {
    return message.author.name?.trim() || message.author.login;
  }
  return (
    message.authorLabel?.trim() ||
    (message.authorKind === "agent" ? "Agent" : "CoDev")
  );
}

/**
 * Collapses a run of posts from one author into a single block, the way every
 * chat client does, so a burst of three lines does not repeat the avatar and
 * name three times.
 */
export function groupChannelMessages(messages: ChannelMessage[]) {
  const groups: ChannelMessageGroup[] = [];
  for (const message of messages) {
    const authorKey = `${message.authorKind}:${message.author?.id ?? message.authorLabel ?? "system"}`;
    const previous = groups.at(-1);
    const withinWindow =
      previous &&
      previous.authorKey === authorKey &&
      Date.parse(message.createdAt) -
        Date.parse(previous.messages.at(-1)!.createdAt) <
        MESSAGE_GROUP_WINDOW_MS;
    if (withinWindow) {
      previous.messages.push(message);
      continue;
    }
    groups.push({
      key: message.id,
      authorKey,
      authorKind: message.authorKind,
      authorName: authorNameFor(message),
      avatarUrl: message.author?.avatarUrl ?? null,
      createdAt: message.createdAt,
      messages: [message],
    });
  }
  return groups;
}

export function formatChatTime(iso: string, now = Date.now()) {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export type AgentDigestChannel = {
  slug: string;
  topic: string | null;
  messages: Array<{ author: string; body: string; createdAt: string }>;
};

/**
 * Renders channel history as the compact transcript an agent reads. Plain
 * text on purpose: it is concatenated into a model prompt, so structure has to
 * survive without markup, and channel names keep their `#` so the agent can
 * refer back to them the way people do.
 */
export function formatTeamChatDigest(channels: AgentDigestChannel[]) {
  const sections = channels
    .filter((channel) => channel.messages.length > 0)
    .map((channel) => {
      const header = channel.topic
        ? `#${channel.slug} — ${channel.topic}`
        : `#${channel.slug}`;
      const lines = channel.messages.map(
        (message) =>
          `[${message.createdAt}] ${message.author}: ${message.body}`,
      );
      return [header, ...lines].join("\n");
    });
  if (sections.length === 0) {
    return "No team chat messages yet.";
  }
  return sections.join("\n\n");
}
