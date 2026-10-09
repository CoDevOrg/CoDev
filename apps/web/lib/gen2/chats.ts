import "server-only";

import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  gen2ChatDetailSchema,
  gen2ChatMessageSchema,
  gen2ChatSchema,
  type Gen2AgentProviderName,
  type Gen2Chat,
  type Gen2ChatDetail,
  type Gen2ChatMessage,
  type Gen2TurnItem,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { Gen2AccessError } from "./errors";
import { GEN2_NEW_CHAT_TITLE, gen2ChatTitleFromPrompt } from "./chats-format";
import { requireGen2Member } from "./workspaces";

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
  provider?: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount?: number | null;
}): Gen2Chat {
  return gen2ChatSchema.parse({
    id: row.id,
    title: row.title,
    provider: row.provider ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    messageCount: row.messageCount ?? undefined,
  });
}

function toMessage(row: {
  id: string;
  role: string;
  body: string;
  items?: unknown;
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
    createdAt: toIso(row.createdAt),
  });
}

export async function listGen2Chats(workspaceId: string, userId: string) {
  await requireGen2Member(workspaceId, userId);
  const rows = await getDatabase()
    .select({
      id: schema.gen2Chats.id,
      title: schema.gen2Chats.title,
      provider: schema.gen2Chats.provider,
      createdAt: schema.gen2Chats.createdAt,
      updatedAt: schema.gen2Chats.updatedAt,
    })
    .from(schema.gen2Chats)
    .where(eq(schema.gen2Chats.workspaceId, workspaceId))
    .orderBy(desc(schema.gen2Chats.updatedAt));

  if (!rows.length) return [];

  try {
    const chatIds = rows.map((r) => r.id);
    const counts = await getDatabase()
      .select({
        chatId: schema.gen2ChatMessages.chatId,
        msgCount: count(),
      })
      .from(schema.gen2ChatMessages)
      .where(inArray(schema.gen2ChatMessages.chatId, chatIds))
      .groupBy(schema.gen2ChatMessages.chatId);

    const countMap = new Map(counts.map((c) => [c.chatId, Number(c.msgCount)]));
    return rows.map((row) =>
      toChat({
        ...row,
        messageCount: countMap.get(row.id) ?? 0,
      }),
    );
  } catch {
    return rows.map(toChat);
  }
}

export async function createGen2Chat(
  workspaceId: string,
  userId: string,
  provider?: Gen2AgentProviderName,
) {
  await requireGen2Member(workspaceId, userId);
  const [created] = await getDatabase()
    .insert(schema.gen2Chats)
    .values({
      workspaceId,
      createdByUserId: userId,
      title: GEN2_NEW_CHAT_TITLE,
      provider: provider ?? null,
    })
    .returning();
  if (!created) {
    throw new Gen2AccessError("Couldn't create a chat.", 500);
  }
  return toChat(created);
}

export async function renameGen2Chat(
  workspaceId: string,
  chatId: string,
  userId: string,
  title: string,
) {
  await requireGen2Member(workspaceId, userId);
  await requireGen2Chat(workspaceId, chatId);
  const [updated] = await getDatabase()
    .update(schema.gen2Chats)
    .set({ title })
    .where(
      and(
        eq(schema.gen2Chats.id, chatId),
        eq(schema.gen2Chats.workspaceId, workspaceId),
      ),
    )
    .returning();
  if (!updated) {
    throw new Gen2AccessError("Chat not found.");
  }
  return toChat(updated);
}

/**
 * A chat belongs to the agent it started with. One created without a provider
 * takes its first turn's provider; later provider changes in the chat do not
 * move it.
 */
export async function claimGen2ChatProvider(
  chatId: string,
  provider: Gen2AgentProviderName,
) {
  await getDatabase()
    .update(schema.gen2Chats)
    .set({ provider })
    .where(
      and(eq(schema.gen2Chats.id, chatId), isNull(schema.gen2Chats.provider)),
    );
}

export async function requireGen2Chat(workspaceId: string, chatId: string) {
  const [row] = await getDatabase()
    .select({
      id: schema.gen2Chats.id,
      title: schema.gen2Chats.title,
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
      body: schema.gen2ChatMessages.body,
      items: schema.gen2ChatMessages.items,
      createdAt: schema.gen2ChatMessages.createdAt,
    })
    .from(schema.gen2ChatMessages)
    .where(eq(schema.gen2ChatMessages.chatId, chatId))
    .orderBy(schema.gen2ChatMessages.createdAt);

  const deduplicated: typeof rows = [];
  for (const row of rows) {
    const prev = deduplicated.at(-1);
    if (prev && prev.role === row.role && prev.body === row.body) {
      continue;
    }
    deduplicated.push(row);
  }
  return deduplicated.map(toMessage);
}

export async function getGen2ChatDetail(
  workspaceId: string,
  chatId: string,
  userId: string,
): Promise<Gen2ChatDetail> {
  await requireGen2Member(workspaceId, userId);
  const chat = await requireGen2Chat(workspaceId, chatId);
  const [messages, [imported]] = await Promise.all([
    listGen2ChatMessages(chat.id),
    getDatabase()
      .select({
        provider: schema.gen2SessionImports.provider,
        meta: schema.gen2SessionImports.meta,
      })
      .from(schema.gen2SessionImports)
      .where(eq(schema.gen2SessionImports.chatId, chat.id))
      .limit(1),
  ]);
  return gen2ChatDetailSchema.parse({
    ...chat,
    messages,
    importedFrom: imported
      ? {
          provider: imported.provider,
          startedAt:
            (imported.meta as { startedAt?: string | null }).startedAt ?? null,
        }
      : null,
  });
}

export async function saveGen2AssistantReply(input: {
  workspaceId: string;
  chatId: string;
  userId: string;
  body: string;
}) {
  await requireGen2Member(input.workspaceId, input.userId);
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

type ChatTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

export async function appendGen2ChatMessage(
  input: {
    chatId: string;
    role: "user" | "assistant";
    body: string;
    items?: Gen2TurnItem[];
  },
  existingTransaction?: ChatTransaction,
) {
  const body = input.body.trim();
  if (!body) {
    return null;
  }
  const save = async (transaction: ChatTransaction) => {
    if (input.role === "assistant") {
      const existing = await transaction
        .select({
          id: schema.gen2ChatMessages.id,
          role: schema.gen2ChatMessages.role,
          body: schema.gen2ChatMessages.body,
          items: schema.gen2ChatMessages.items,
          createdAt: schema.gen2ChatMessages.createdAt,
        })
        .from(schema.gen2ChatMessages)
        .where(eq(schema.gen2ChatMessages.chatId, input.chatId))
        .orderBy(desc(schema.gen2ChatMessages.createdAt))
        .limit(1);
      const last = existing[0];
      if (last && last.role === "assistant" && last.body === body) {
        return toMessage(last);
      }
    }
    const [created] = await transaction
      .insert(schema.gen2ChatMessages)
      .values({
        chatId: input.chatId,
        role: input.role,
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
  };
  return existingTransaction
    ? save(existingTransaction)
    : getDatabase().transaction(save);
}
