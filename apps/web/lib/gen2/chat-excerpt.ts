import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { deserializeGen2Mentions } from "./prompt-mentions";

const MAX_MESSAGES = 12;
const MAX_EXCERPT_CHARS = 2_500;
const MAX_MESSAGE_CHARS = 1_200;
const OMITTED = "[Older messages omitted.]";

/** The body arrives one character past the cap, so a longer one shows it. */
function messageLine(role: string, body: string) {
  const text = deserializeGen2Mentions(body.slice(0, MAX_MESSAGE_CHARS))
    .text.replace(/\n{3,}/g, "\n\n")
    .trim();
  const clipped = body.length > MAX_MESSAGE_CHARS ? `${text}...` : text;
  return `${role === "user" ? "User" : "Assistant"}: ${clipped}`;
}

/**
 * The newest messages of another chat in the same workspace, for an
 * @-mention: one query scoped by the chat's workspace, packed newest-last
 * under a character budget. Each body is cut short in the database, since
 * replies can be long and only their start is shown. Null when the chat is
 * not in this workspace. The caller quotes the text.
 */
export async function readGen2ChatExcerpt(workspaceId: string, chatId: string) {
  const rows = await getDatabase()
    .select({
      title: schema.gen2Chats.title,
      role: schema.gen2ChatMessages.role,
      body: sql<
        string | null
      >`left(${schema.gen2ChatMessages.body}, ${MAX_MESSAGE_CHARS + 1})`,
    })
    .from(schema.gen2Chats)
    .leftJoin(
      schema.gen2ChatMessages,
      eq(schema.gen2ChatMessages.chatId, schema.gen2Chats.id),
    )
    .where(
      and(
        eq(schema.gen2Chats.id, chatId),
        eq(schema.gen2Chats.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(schema.gen2ChatMessages.createdAt))
    // One more than is shown: it says whether older messages exist.
    .limit(MAX_MESSAGES + 1);
  const [first] = rows;
  if (!first) return null;

  const messages = rows
    .slice(0, MAX_MESSAGES)
    .flatMap(({ role, body }) =>
      role === null || body === null ? [] : [{ role, body }],
    );
  const lines: string[] = [];
  let used = OMITTED.length;
  for (const message of messages) {
    const line = messageLine(message.role, message.body);
    if (used + line.length + 1 > MAX_EXCERPT_CHARS) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  const omitted = lines.length < messages.length || rows.length > MAX_MESSAGES;
  return {
    title: first.title,
    text: [...(omitted ? [OMITTED] : []), ...lines].join("\n"),
  };
}
