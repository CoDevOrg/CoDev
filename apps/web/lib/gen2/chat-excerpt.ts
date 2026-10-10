import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { deserializeGen2Mentions } from "./prompt-mentions";

const MAX_MESSAGES = 12;
const MAX_EXCERPT_CHARS = 2_500;
const MAX_MESSAGE_CHARS = 1_200;
const OMITTED = "[Older messages omitted.]";

function messageLine(role: string, body: string) {
  const text = deserializeGen2Mentions(body)
    .text.replace(/[^\P{Cc}\n\t]/gu, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const clipped =
    text.length > MAX_MESSAGE_CHARS
      ? `${text.slice(0, MAX_MESSAGE_CHARS)}...`
      : text;
  return `${role === "user" ? "User" : "Assistant"}: ${clipped}`;
}

/**
 * The newest messages of another chat in the same workspace, for an
 * @-mention: one query scoped by the chat's workspace, packed newest-last
 * under a character budget. Null when the chat is not in this workspace.
 */
export async function readGen2ChatExcerpt(workspaceId: string, chatId: string) {
  const rows = await getDatabase()
    .select({
      title: schema.gen2Chats.title,
      role: schema.gen2ChatMessages.role,
      body: schema.gen2ChatMessages.body,
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
    .limit(MAX_MESSAGES);
  const [first] = rows;
  if (!first) return null;

  const lines: string[] = [];
  let used = OMITTED.length;
  for (const row of rows) {
    if (row.role === null || row.body === null) continue;
    const line = messageLine(row.role, row.body);
    if (used + line.length + 1 > MAX_EXCERPT_CHARS) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  const messages = rows.filter((row) => row.body !== null).length;
  const omitted = lines.length < messages || rows.length === MAX_MESSAGES;
  return {
    title: first.title,
    text: [...(omitted ? [OMITTED] : []), ...lines].join("\n"),
  };
}
