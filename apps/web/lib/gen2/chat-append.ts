import "server-only";

import { desc, eq } from "drizzle-orm";

import {
  gen2ChatMessageSchema,
  type Gen2ChatMessage,
  type Gen2TurnItem,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { Gen2AccessError } from "./errors";
import { GEN2_NEW_CHAT_TITLE, gen2ChatTitleFromPrompt } from "./chats-format";
import { publishGen2WorkspaceEvent } from "./workspace-events";

export function toGen2ChatMessage(row: {
  id: string;
  role: string;
  body: string;
  items?: unknown;
  authorUserId?: string | null;
  createdAt: Date;
}): Gen2ChatMessage {
  return gen2ChatMessageSchema.parse({
    id: row.id,
    role: row.role,
    body: row.body,
    // Replies saved before activity cards existed have no items; a shape we
    // no longer recognise is dropped rather than failing the whole thread.
    items:
      gen2ChatMessageSchema.shape.items.safeParse(row.items ?? null).data ??
      null,
    authorUserId: row.authorUserId ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

type ChatTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

type AppendInput = {
  chatId: string;
  role: "user" | "assistant";
  body: string;
  items?: Gen2TurnItem[];
  /** The member who sent a user message. */
  authorUserId?: string;
  /** Pushes the message to members' open tabs once it commits. */
  workspaceId?: string;
};

async function lastMessage(transaction: ChatTransaction, chatId: string) {
  const [last] = await transaction
    .select({
      id: schema.gen2ChatMessages.id,
      role: schema.gen2ChatMessages.role,
      body: schema.gen2ChatMessages.body,
      items: schema.gen2ChatMessages.items,
      authorUserId: schema.gen2ChatMessages.authorUserId,
      createdAt: schema.gen2ChatMessages.createdAt,
    })
    .from(schema.gen2ChatMessages)
    .where(eq(schema.gen2ChatMessages.chatId, chatId))
    .orderBy(desc(schema.gen2ChatMessages.createdAt))
    .limit(1);
  return last;
}

/** A chat's first prompt names it. */
async function renamedTitle(
  transaction: ChatTransaction,
  input: AppendInput,
  body: string,
) {
  if (input.role !== "user") return undefined;
  const [chat] = await transaction
    .select({ title: schema.gen2Chats.title })
    .from(schema.gen2Chats)
    .where(eq(schema.gen2Chats.id, input.chatId))
    .limit(1);
  return chat?.title === GEN2_NEW_CHAT_TITLE
    ? gen2ChatTitleFromPrompt(body)
    : undefined;
}

async function saveMessage(
  transaction: ChatTransaction,
  input: AppendInput,
  body: string,
) {
  if (input.role === "assistant") {
    const last = await lastMessage(transaction, input.chatId);
    if (last && last.role === "assistant" && last.body === body)
      return { message: toGen2ChatMessage(last), created: false };
  }
  const [created] = await transaction
    .insert(schema.gen2ChatMessages)
    .values({
      chatId: input.chatId,
      role: input.role,
      body,
      items: input.items ?? null,
      authorUserId: input.role === "user" ? (input.authorUserId ?? null) : null,
    })
    .returning();
  if (!created) {
    throw new Gen2AccessError("Couldn't save that message.", 500);
  }
  const title = await renamedTitle(transaction, input, body);
  const updatedAt = new Date();
  await transaction
    .update(schema.gen2Chats)
    .set(title ? { updatedAt, title } : { updatedAt })
    .where(eq(schema.gen2Chats.id, input.chatId));
  return {
    message: toGen2ChatMessage(created),
    created: true,
    title,
    updatedAt,
  };
}

export async function appendGen2ChatMessage(
  input: AppendInput,
  existingTransaction?: ChatTransaction,
) {
  const body = input.body.trim();
  if (!body) {
    return null;
  }
  const save = (transaction: ChatTransaction) =>
    saveMessage(transaction, input, body);
  if (existingTransaction) return (await save(existingTransaction)).message;
  const saved = await getDatabase().transaction(save);
  if (saved.created && input.workspaceId)
    await publishGen2WorkspaceEvent(input.workspaceId, {
      kind: "chat.message",
      chatId: input.chatId,
      messageId: saved.message.id,
      message: saved.message,
      ...(saved.title ? { title: saved.title } : {}),
      updatedAt: (saved.updatedAt ?? new Date()).toISOString(),
    });
  return saved.message;
}
