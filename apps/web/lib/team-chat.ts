import "server-only";

import {
  parseMentionedLogins,
  mentionsAgent as bodyMentionsAgent,
  type ChannelMessage,
  type ChannelSummary,
  type CreateChannelInput,
} from "@codev/contracts";
import { schema } from "@codev/db";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { getDatabase } from "./database";
import { TeamChatError } from "./team-chat-error";
import { formatTeamChatDigest } from "./team-chat-view";

export { TeamChatError };

/**
 * Every workspace opens with these. A brand new workspace showing an empty
 * channel list would leave the first member with nowhere to type, and the
 * agent with no obvious place to report into.
 */
const SEED_CHANNELS: Array<{ slug: string; topic: string }> = [
  { slug: "general", topic: "Everything about this workspace." },
  { slug: "standup", topic: "What everyone is working on today." },
];

const MESSAGE_PAGE_SIZE = 60;
/** Upper bound on what a single agent context read pulls per channel. */
const AGENT_DIGEST_PER_CHANNEL = 30;

type MessageRow = {
  id: string;
  channelId: string;
  authorKind: "member" | "agent" | "system";
  authorLabel: string | null;
  body: string;
  mentionsAgent: boolean;
  createdAt: Date;
  authorId: string | null;
  authorLogin: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
};

function toChannelMessage(row: MessageRow): ChannelMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    authorKind: row.authorKind,
    author:
      row.authorId && row.authorLogin
        ? {
            id: row.authorId,
            login: row.authorLogin,
            name: row.authorName,
            avatarUrl: row.authorAvatarUrl,
          }
        : null,
    authorLabel: row.authorLabel,
    body: row.body,
    mentionsAgent: row.mentionsAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

const messageSelection = {
  id: schema.workspaceChannelMessages.id,
  channelId: schema.workspaceChannelMessages.channelId,
  authorKind: schema.workspaceChannelMessages.authorKind,
  authorLabel: schema.workspaceChannelMessages.authorLabel,
  body: schema.workspaceChannelMessages.body,
  mentionsAgent: schema.workspaceChannelMessages.mentionsAgent,
  createdAt: schema.workspaceChannelMessages.createdAt,
  authorId: schema.users.id,
  authorLogin: schema.users.login,
  authorName: schema.users.name,
  authorAvatarUrl: schema.users.avatarUrl,
};

export async function ensureWorkspaceChannels(workspaceId: string) {
  await getDatabase()
    .insert(schema.workspaceChannels)
    .values(
      SEED_CHANNELS.map((channel) => ({
        workspaceId,
        slug: channel.slug,
        topic: channel.topic,
      })),
    )
    .onConflictDoNothing();
}

export async function listWorkspaceChannels(
  workspaceId: string,
  viewerId: string,
): Promise<ChannelSummary[]> {
  await ensureWorkspaceChannels(workspaceId);
  const database = getDatabase();

  const rows = await database
    .select({
      id: schema.workspaceChannels.id,
      slug: schema.workspaceChannels.slug,
      topic: schema.workspaceChannels.topic,
      agentAccess: schema.workspaceChannels.agentAccess,
      messageCount: sql<number>`count(${schema.workspaceChannelMessages.id})::int`,
      lastMessageAt: sql<Date | null>`max(${schema.workspaceChannelMessages.createdAt})`,
      // Own posts never count as unread, and neither does anything the member
      // has already scrolled past.
      unreadCount: sql<number>`count(${schema.workspaceChannelMessages.id}) filter (
        where ${schema.workspaceChannelMessages.createdAt} >
            coalesce(${schema.workspaceChannelReads.lastReadAt}, to_timestamp(0))
          and coalesce(${schema.workspaceChannelMessages.authorId}::text, '') <> ${viewerId}
      )::int`,
    })
    .from(schema.workspaceChannels)
    .leftJoin(
      schema.workspaceChannelMessages,
      eq(
        schema.workspaceChannelMessages.channelId,
        schema.workspaceChannels.id,
      ),
    )
    .leftJoin(
      schema.workspaceChannelReads,
      and(
        eq(schema.workspaceChannelReads.channelId, schema.workspaceChannels.id),
        eq(schema.workspaceChannelReads.userId, viewerId),
      ),
    )
    .where(
      and(
        eq(schema.workspaceChannels.workspaceId, workspaceId),
        isNull(schema.workspaceChannels.archivedAt),
      ),
    )
    .groupBy(
      schema.workspaceChannels.id,
      schema.workspaceChannels.slug,
      schema.workspaceChannels.topic,
      schema.workspaceChannels.agentAccess,
      schema.workspaceChannelReads.lastReadAt,
    )
    .orderBy(asc(schema.workspaceChannels.slug));

  const previews = await database
    .selectDistinctOn([schema.workspaceChannelMessages.channelId], {
      channelId: schema.workspaceChannelMessages.channelId,
      body: schema.workspaceChannelMessages.body,
      authorKind: schema.workspaceChannelMessages.authorKind,
      authorLabel: schema.workspaceChannelMessages.authorLabel,
      authorLogin: schema.users.login,
      authorName: schema.users.name,
    })
    .from(schema.workspaceChannelMessages)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.workspaceChannelMessages.authorId),
    )
    .where(eq(schema.workspaceChannelMessages.workspaceId, workspaceId))
    .orderBy(
      asc(schema.workspaceChannelMessages.channelId),
      desc(schema.workspaceChannelMessages.createdAt),
    );

  const previewByChannel = new Map(
    previews.map((preview) => [preview.channelId, preview]),
  );

  return rows.map((row) => {
    const preview = previewByChannel.get(row.id);
    return {
      id: row.id,
      slug: row.slug,
      topic: row.topic,
      agentAccess: row.agentAccess,
      messageCount: Number(row.messageCount ?? 0),
      unreadCount: Number(row.unreadCount ?? 0),
      lastMessageAt: row.lastMessageAt
        ? new Date(row.lastMessageAt).toISOString()
        : null,
      lastMessagePreview: preview?.body ?? null,
      lastMessageAuthor: preview
        ? preview.authorName?.trim() ||
          preview.authorLogin ||
          preview.authorLabel ||
          null
        : null,
    };
  });
}

export async function createWorkspaceChannel(
  workspaceId: string,
  userId: string,
  input: CreateChannelInput,
) {
  const [existing] = await getDatabase()
    .select({ id: schema.workspaceChannels.id })
    .from(schema.workspaceChannels)
    .where(
      and(
        eq(schema.workspaceChannels.workspaceId, workspaceId),
        eq(schema.workspaceChannels.slug, input.slug),
      ),
    )
    .limit(1);
  if (existing) {
    throw new TeamChatError(`#${input.slug} already exists.`, 409);
  }

  const [created] = await getDatabase()
    .insert(schema.workspaceChannels)
    .values({
      workspaceId,
      slug: input.slug,
      topic: input.topic ?? null,
      agentAccess: input.agentAccess ?? true,
      createdBy: userId,
    })
    .returning({
      id: schema.workspaceChannels.id,
      slug: schema.workspaceChannels.slug,
      topic: schema.workspaceChannels.topic,
      agentAccess: schema.workspaceChannels.agentAccess,
    });
  if (!created) throw new TeamChatError("The channel could not be created.");
  return created;
}

async function requireChannel(workspaceId: string, channelId: string) {
  const [channel] = await getDatabase()
    .select({
      id: schema.workspaceChannels.id,
      slug: schema.workspaceChannels.slug,
      topic: schema.workspaceChannels.topic,
      agentAccess: schema.workspaceChannels.agentAccess,
    })
    .from(schema.workspaceChannels)
    .where(
      and(
        eq(schema.workspaceChannels.id, channelId),
        eq(schema.workspaceChannels.workspaceId, workspaceId),
        isNull(schema.workspaceChannels.archivedAt),
      ),
    )
    .limit(1);
  if (!channel) throw new TeamChatError("Channel not found.", 404);
  return channel;
}

export async function listChannelMessages(
  workspaceId: string,
  channelId: string,
  options: { limit?: number; before?: string } = {},
) {
  const channel = await requireChannel(workspaceId, channelId);
  const limit = Math.min(Math.max(options.limit ?? MESSAGE_PAGE_SIZE, 1), 200);

  const conditions = [
    eq(schema.workspaceChannelMessages.channelId, channel.id),
  ];
  if (options.before) {
    conditions.push(
      lt(schema.workspaceChannelMessages.createdAt, new Date(options.before)),
    );
  }

  const rows = await getDatabase()
    .select(messageSelection)
    .from(schema.workspaceChannelMessages)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.workspaceChannelMessages.authorId),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.workspaceChannelMessages.createdAt))
    .limit(limit);

  return {
    channel,
    // Oldest first: the transcript reads top to bottom like every chat client.
    messages: rows.reverse().map(toChannelMessage),
  };
}

async function resolveMentionedMemberIds(workspaceId: string, body: string) {
  const logins = parseMentionedLogins(body);
  if (logins.length === 0) return [];
  const rows = await getDatabase()
    .select({ id: schema.users.id, login: schema.users.login })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.workspaceMembers.userId),
    )
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        inArray(sql`lower(${schema.users.login})`, logins),
      ),
    );
  return rows.map((row) => row.id);
}

export async function postChannelMessage(input: {
  workspaceId: string;
  channelId: string;
  body: string;
  author:
    | { kind: "member"; userId: string }
    | { kind: "agent"; label: string; agentSessionId?: string | null }
    | { kind: "system"; label?: string };
}) {
  const channel = await requireChannel(input.workspaceId, input.channelId);
  if (input.author.kind === "agent" && !channel.agentAccess) {
    throw new TeamChatError(`#${channel.slug} is closed to agents.`, 403);
  }

  const mentions = await resolveMentionedMemberIds(
    input.workspaceId,
    input.body,
  );

  const [inserted] = await getDatabase()
    .insert(schema.workspaceChannelMessages)
    .values({
      channelId: channel.id,
      workspaceId: input.workspaceId,
      authorKind: input.author.kind,
      authorId: input.author.kind === "member" ? input.author.userId : null,
      authorLabel:
        input.author.kind === "member" ? null : (input.author.label ?? "CoDev"),
      agentSessionId:
        input.author.kind === "agent"
          ? (input.author.agentSessionId ?? null)
          : null,
      body: input.body,
      mentions,
      mentionsAgent: bodyMentionsAgent(input.body),
    })
    .returning({ id: schema.workspaceChannelMessages.id });
  if (!inserted) throw new TeamChatError("The message could not be posted.");

  // Posting is reading: a member should never come back to their own message
  // sitting in an unread badge.
  if (input.author.kind === "member") {
    await markChannelRead(channel.id, input.author.userId);
  }

  const [row] = await getDatabase()
    .select(messageSelection)
    .from(schema.workspaceChannelMessages)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.workspaceChannelMessages.authorId),
    )
    .where(eq(schema.workspaceChannelMessages.id, inserted.id))
    .limit(1);
  if (!row) throw new TeamChatError("The message could not be read back.");
  return { channel, message: toChannelMessage(row) };
}

export async function markChannelRead(channelId: string, userId: string) {
  await getDatabase()
    .insert(schema.workspaceChannelReads)
    .values({ channelId, userId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [
        schema.workspaceChannelReads.channelId,
        schema.workspaceChannelReads.userId,
      ],
      set: { lastReadAt: new Date() },
    });
}

/**
 * The agent-facing read of team chat: only channels that allow agents, most
 * recent conversation first, rendered as plain text for a prompt.
 */
export async function readTeamChatContext(
  workspaceId: string,
  options: { channelSlug?: string; perChannel?: number } = {},
) {
  await ensureWorkspaceChannels(workspaceId);
  const conditions = [
    eq(schema.workspaceChannels.workspaceId, workspaceId),
    eq(schema.workspaceChannels.agentAccess, true),
    isNull(schema.workspaceChannels.archivedAt),
  ];
  if (options.channelSlug) {
    conditions.push(eq(schema.workspaceChannels.slug, options.channelSlug));
  }

  const channels = await getDatabase()
    .select({
      id: schema.workspaceChannels.id,
      slug: schema.workspaceChannels.slug,
      topic: schema.workspaceChannels.topic,
    })
    .from(schema.workspaceChannels)
    .where(and(...conditions))
    .orderBy(asc(schema.workspaceChannels.slug));

  const perChannel = Math.min(
    Math.max(options.perChannel ?? AGENT_DIGEST_PER_CHANNEL, 1),
    100,
  );

  const sections = [];
  for (const channel of channels) {
    const rows = await getDatabase()
      .select(messageSelection)
      .from(schema.workspaceChannelMessages)
      .leftJoin(
        schema.users,
        eq(schema.users.id, schema.workspaceChannelMessages.authorId),
      )
      .where(eq(schema.workspaceChannelMessages.channelId, channel.id))
      .orderBy(desc(schema.workspaceChannelMessages.createdAt))
      .limit(perChannel);
    sections.push({
      slug: channel.slug,
      topic: channel.topic,
      messages: rows.reverse().map((row) => {
        const message = toChannelMessage(row);
        return {
          author:
            message.author?.name?.trim() ||
            message.author?.login ||
            message.authorLabel ||
            "CoDev",
          body: message.body,
          createdAt: message.createdAt,
        };
      }),
    });
  }

  return { channels: sections, digest: formatTeamChatDigest(sections) };
}

/** Resolves a channel by name for agents, which speak in `#slug` not uuids. */
export async function findChannelBySlug(workspaceId: string, slug: string) {
  const [channel] = await getDatabase()
    .select({
      id: schema.workspaceChannels.id,
      slug: schema.workspaceChannels.slug,
      agentAccess: schema.workspaceChannels.agentAccess,
    })
    .from(schema.workspaceChannels)
    .where(
      and(
        eq(schema.workspaceChannels.workspaceId, workspaceId),
        eq(schema.workspaceChannels.slug, slug),
        isNull(schema.workspaceChannels.archivedAt),
      ),
    )
    .limit(1);
  return channel ?? null;
}
