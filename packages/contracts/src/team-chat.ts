import { z } from "zod";

import { collaborationUserSchema } from "./collaboration";
import { identifierSchema, timestampSchema } from "./domain";

/**
 * The literal token a member types to bring the workspace's coding agent into
 * a channel conversation. Kept here so the composer hint, the mention parser,
 * and the agent-facing prompt can never drift apart.
 */
export const AGENT_MENTION = "@agent";

export const CHANNEL_MESSAGE_MAX_LENGTH = 4_000;
export const CHANNEL_TOPIC_MAX_LENGTH = 280;

/**
 * Slack-ish channel names: lowercase, hyphen separated, no leading `#`. The
 * UI renders the `#` itself so a stored name never carries it twice.
 */
export const channelSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Channel names use lowercase letters, numbers and hyphens.",
  );

export const channelTopicSchema = z
  .string()
  .trim()
  .max(CHANNEL_TOPIC_MAX_LENGTH)
  .nullable();

export const createChannelSchema = z.object({
  slug: channelSlugSchema,
  topic: channelTopicSchema.optional(),
  agentAccess: z.boolean().optional(),
});

export const channelMessageBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(CHANNEL_MESSAGE_MAX_LENGTH);

export const postChannelMessageSchema = z.object({
  body: channelMessageBodySchema,
});

export const memberStatusSchema = z.object({
  headline: z.string().trim().max(120).nullable(),
  emoji: z.string().trim().max(8).nullable(),
});

export const channelMessageAuthorKindSchema = z.enum([
  "member",
  "agent",
  "system",
]);

export const channelSummarySchema = z.object({
  id: identifierSchema,
  slug: channelSlugSchema,
  topic: z.string().nullable(),
  agentAccess: z.boolean(),
  messageCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  lastMessageAt: timestampSchema.nullable(),
  lastMessagePreview: z.string().nullable(),
  lastMessageAuthor: z.string().nullable(),
});

export const channelMessageSchema = z.object({
  id: identifierSchema,
  channelId: identifierSchema,
  authorKind: channelMessageAuthorKindSchema,
  author: collaborationUserSchema.nullable(),
  authorLabel: z.string().nullable(),
  body: z.string(),
  mentionsAgent: z.boolean(),
  createdAt: timestampSchema,
});

/**
 * One row of the people list: who they are, whether they are here right now,
 * and the most specific thing we can honestly say they are working on.
 */
export const teamMemberPresenceSchema = z.object({
  user: collaborationUserSchema,
  accessRole: z.string(),
  isViewer: z.boolean(),
  online: z.boolean(),
  /** The member's own status line, when they set one. */
  headline: z.string().nullable(),
  emoji: z.string().nullable(),
  /** Editor file from live presence, when they are in a file right now. */
  activePath: z.string().nullable(),
  /** What their agent is doing, when they have one running. */
  agentTask: z.string().nullable(),
  agentProvider: z.string().nullable(),
});

export const teamRosterSchema = z.object({
  viewerId: identifierSchema,
  members: z.array(teamMemberPresenceSchema),
  agents: z.array(
    z.object({
      sessionId: identifierSchema,
      name: z.string(),
      provider: z.string(),
      status: z.string(),
      currentTask: z.string(),
      owner: z.string(),
    }),
  ),
});

export type ChannelSummary = z.infer<typeof channelSummarySchema>;
export type ChannelMessage = z.infer<typeof channelMessageSchema>;
export type ChannelMessageAuthorKind = z.infer<
  typeof channelMessageAuthorKindSchema
>;
export type TeamMemberPresence = z.infer<typeof teamMemberPresenceSchema>;
export type TeamRoster = z.infer<typeof teamRosterSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type MemberStatusInput = z.infer<typeof memberStatusSchema>;

/**
 * Does this message body summon the agent? Matched on a word boundary so
 * `@agents` or an email-ish `x@agent.io` does not trigger a run.
 */
export function mentionsAgent(body: string) {
  return new RegExp(`(^|[^\\w@/.-])${AGENT_MENTION}\\b`, "i").test(body);
}

/**
 * Extracts `@login` handles from a message body. Returns lowercase logins in
 * first-appearance order, without the agent token.
 */
export function parseMentionedLogins(body: string) {
  const logins: string[] = [];
  for (const match of body.matchAll(
    /(^|[^\w@/.-])@([a-z0-9][a-z0-9-]{0,38})/gi,
  )) {
    const login = match[2]?.toLowerCase();
    if (!login || login === "agent" || logins.includes(login)) continue;
    logins.push(login);
  }
  return logins;
}
