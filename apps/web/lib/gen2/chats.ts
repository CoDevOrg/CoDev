import "server-only";

import { and, desc, eq } from "drizzle-orm";

import {
  gen2ChatDetailSchema,
  gen2ChatMessageSchema,
  gen2ChatSchema,
  type Gen2Chat,
  type Gen2ChatDetail,
  type Gen2ChatMessage,
  type Gen2TurnItem,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { requireWorkspacePermission } from "../policies/workspace";
import { Gen2AccessError } from "./errors";
import { GEN2_NEW_CHAT_TITLE, gen2ChatTitleFromPrompt } from "./chats-format";

export {
  formatGen2TurnPrompt,
  GEN2_NEW_CHAT_TITLE,
  gen2ChatTitleFromPrompt,
} from "./chats-format";

function toIso(value: Date) {
  return value.toISOString();
}

function toChat(row: {
  id: string;
  title: string;
  defaultProvider: Gen2Chat["defaultProvider"];
  createdAt: Date;
  updatedAt: Date;
}): Gen2Chat {
  return gen2ChatSchema.parse({
    id: row.id,
    title: row.title,
    defaultProvider: row.defaultProvider,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function toMessage(row: {
  id: string;
  role: string;
  body: string;
  provider?: Gen2ChatMessage["provider"];
  items?: unknown;
  createdAt: Date;
}): Gen2ChatMessage {
  return gen2ChatMessageSchema.parse({
    id: row.id,
    role: row.role,
    provider: row.provider ?? null,
    body: row.body,
    // Replies saved before activity cards existed have no items; a shape we
    // no longer recognise is dropped rather than failing the whole thread.
    items:
      gen2ChatMessageSchema.shape.items.safeParse(row.items ?? null).data ??
      null,
    createdAt: toIso(row.createdAt),
  });
}

export async function listGen2Chats(workspaceId: string, userId: string) {
  await requireWorkspacePermission(workspaceId, userId, "context.view");
  const rows = await getDatabase()
    .select({
      id: schema.gen2Chats.id,
      title: schema.gen2Chats.title,
      defaultProvider: schema.gen2Chats.defaultProvider,
      createdAt: schema.gen2Chats.createdAt,
      updatedAt: schema.gen2Chats.updatedAt,
    })
    .from(schema.gen2Chats)
    .where(eq(schema.gen2Chats.workspaceId, workspaceId))
    .orderBy(desc(schema.gen2Chats.updatedAt));
  return rows.map(toChat);
}

export async function createGen2Chat(workspaceId: string, userId: string) {
  await requireWorkspacePermission(workspaceId, userId, "agent.run");
  await requireWorkspacePermission(
    workspaceId,
    userId,
    "context.includeInTurn",
  );
  const [created] = await getDatabase()
    .insert(schema.gen2Chats)
    .values({
      workspaceId,
      createdByUserId: userId,
      title: GEN2_NEW_CHAT_TITLE,
    })
    .returning();
  if (!created) {
    throw new Gen2AccessError("Couldn't create a chat.", 500);
  }
  return toChat(created);
}

export async function requireGen2Chat(workspaceId: string, chatId: string) {
  const [row] = await getDatabase()
    .select({
      id: schema.gen2Chats.id,
      title: schema.gen2Chats.title,
      defaultProvider: schema.gen2Chats.defaultProvider,
      createdAt: schema.gen2Chats.createdAt,
      updatedAt: schema.gen2Chats.updatedAt,
    })
    .from(schema.gen2Chats)
    .where(
      and(
        eq(schema.gen2Chats.id, chatId),
        eq(schema.gen2Chats.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Gen2AccessError("Chat not found.");
  }
  return toChat(row);
}

export async function listGen2ChatMessages(chatId: string) {
  const rows = await getDatabase()
    .select({
      id: schema.gen2ChatMessages.id,
      role: schema.gen2ChatMessages.role,
      provider: schema.gen2ChatMessages.provider,
      body: schema.gen2ChatMessages.body,
      items: schema.gen2ChatMessages.items,
      createdAt: schema.gen2ChatMessages.createdAt,
    })
    .from(schema.gen2ChatMessages)
    .where(eq(schema.gen2ChatMessages.chatId, chatId))
    .orderBy(schema.gen2ChatMessages.createdAt);
  return rows.map(toMessage);
}

export async function getGen2ChatDetail(
  workspaceId: string,
  chatId: string,
  userId: string,
): Promise<Gen2ChatDetail> {
  await requireWorkspacePermission(workspaceId, userId, "context.view");
  const chat = await requireGen2Chat(workspaceId, chatId);
  return gen2ChatDetailSchema.parse({
    ...chat,
    messages: await listGen2ChatMessages(chat.id),
  });
}

export async function updateGen2ChatDefaultProvider(input: {
  workspaceId: string;
  chatId: string;
  userId: string;
  defaultProvider: Gen2Chat["defaultProvider"];
}) {
  await requireWorkspacePermission(
    input.workspaceId,
    input.userId,
    "agent.run",
  );
  await requireGen2Chat(input.workspaceId, input.chatId);
  await getDatabase()
    .update(schema.gen2Chats)
    .set({
      defaultProvider: input.defaultProvider,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.gen2Chats.workspaceId, input.workspaceId),
        eq(schema.gen2Chats.id, input.chatId),
      ),
    );
  return requireGen2Chat(input.workspaceId, input.chatId);
}

export async function saveGen2AssistantReply(input: {
  workspaceId: string;
  chatId: string;
  userId: string;
  body: string;
}) {
  await requireWorkspacePermission(
    input.workspaceId,
    input.userId,
    "context.includeInTurn",
  );
  await requireGen2Chat(input.workspaceId, input.chatId);
  const body = input.body.trim();
  if (!body || body === "Working…") {
    return null;
  }
  const existing = await listGen2ChatMessages(input.chatId);
  const last = existing.at(-1);
  if (last?.role === "assistant" && last.body === body) {
    return last;
  }
  return appendGen2ChatMessage({
    chatId: input.chatId,
    role: "assistant",
    body,
  });
}

export async function appendGen2ChatMessage(input: {
  chatId: string;
  role: "user" | "assistant";
  body: string;
  items?: Gen2TurnItem[];
  provider?: Gen2ChatMessage["provider"];
}) {
  const body = input.body.trim();
  if (!body) {
    return null;
  }
  return getDatabase().transaction(async (transaction) => {
    const [created] = await transaction
      .insert(schema.gen2ChatMessages)
      .values({
        chatId: input.chatId,
        role: input.role,
        provider: input.provider ?? null,
        body,
        items: input.items ?? null,
      })
      .returning();
    if (!created) {
      throw new Gen2AccessError("Couldn't save that message.", 500);
    }
    const patch: { updatedAt: Date; title?: string } = {
      updatedAt: new Date(),
    };
    if (input.role === "user") {
      const [chat] = await transaction
        .select({ title: schema.gen2Chats.title })
        .from(schema.gen2Chats)
        .where(eq(schema.gen2Chats.id, input.chatId))
        .limit(1);
      if (chat?.title === GEN2_NEW_CHAT_TITLE) {
        patch.title = gen2ChatTitleFromPrompt(body);
      }
    }
    await transaction
      .update(schema.gen2Chats)
      .set(patch)
      .where(eq(schema.gen2Chats.id, input.chatId));
    return toMessage(created);
  });
}
