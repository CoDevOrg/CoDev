import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gt, sql } from "drizzle-orm";

import { schema, type WorkspaceChatPromptAttachment } from "@codev/db";

import { getDatabase } from "./database";

export const WORKSPACE_CHAT_LEASE_MS = 30_000;
export const WORKSPACE_CHAT_PRESENCE_MS = 35_000;

export type WorkspaceChatMember = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type WorkspaceChatPromptReceipt = {
  id: string;
  clientMessageId: string;
  author: WorkspaceChatMember;
  prompt: string;
  attachments: WorkspaceChatPromptAttachment[];
  provider: string;
  model: string | null;
  effort: string | null;
  createdAt: string;
};

export type WorkspaceChatSnapshot = {
  viewer: WorkspaceChatMember;
  lease: {
    holder: WorkspaceChatMember;
    clientId: string;
    expiresAt: string;
  } | null;
  participants: WorkspaceChatMember[];
  receipts: WorkspaceChatPromptReceipt[];
  serverTime: string;
};

export class WorkspaceChatCoordinationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "WorkspaceChatCoordinationError";
  }
}

function memberName(
  name: string | null | undefined,
  login: string | null | undefined,
) {
  return name?.trim() || login?.trim() || "Workspace member";
}

function member(input: {
  id: string;
  name: string | null;
  login: string;
  avatarUrl: string | null;
}): WorkspaceChatMember {
  return {
    id: input.id,
    name: memberName(input.name, input.login),
    avatarUrl: input.avatarUrl,
  };
}

function expiry(milliseconds: number) {
  return new Date(Date.now() + milliseconds);
}

async function lockChat(
  transaction: Parameters<
    Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
  >[0],
  workspaceId: string,
  chatId: string,
) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${chatId}`}, 0))`,
  );
}

export async function heartbeatWorkspaceChat(
  workspaceId: string,
  chatId: string,
  userId: string,
  clientId: string,
) {
  const now = new Date();
  await getDatabase()
    .insert(schema.workspaceChatParticipants)
    .values({
      workspaceId,
      chatId,
      userId,
      clientId,
      expiresAt: expiry(WORKSPACE_CHAT_PRESENCE_MS),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.workspaceChatParticipants.workspaceId,
        schema.workspaceChatParticipants.chatId,
        schema.workspaceChatParticipants.userId,
        schema.workspaceChatParticipants.clientId,
      ],
      set: {
        expiresAt: expiry(WORKSPACE_CHAT_PRESENCE_MS),
        updatedAt: now,
      },
    });
}

export async function leaveWorkspaceChat(
  workspaceId: string,
  chatId: string,
  userId: string,
  clientId: string,
) {
  await getDatabase()
    .delete(schema.workspaceChatParticipants)
    .where(
      and(
        eq(schema.workspaceChatParticipants.workspaceId, workspaceId),
        eq(schema.workspaceChatParticipants.chatId, chatId),
        eq(schema.workspaceChatParticipants.userId, userId),
        eq(schema.workspaceChatParticipants.clientId, clientId),
      ),
    );
}

export async function acquireWorkspaceChatLease(
  workspaceId: string,
  chatId: string,
  userId: string,
  clientId: string,
) {
  return getDatabase().transaction(async (transaction) => {
    await lockChat(transaction, workspaceId, chatId);
    const now = new Date();
    const [current] = await transaction
      .select()
      .from(schema.workspaceChatLeases)
      .where(
        and(
          eq(schema.workspaceChatLeases.workspaceId, workspaceId),
          eq(schema.workspaceChatLeases.chatId, chatId),
        ),
      )
      .limit(1);

    if (
      current &&
      current.expiresAt > now &&
      (current.holderId !== userId || current.clientId !== clientId)
    ) {
      throw new WorkspaceChatCoordinationError(
        current.holderId === userId
          ? "This chat is being edited in another one of your tabs."
          : "Another workspace member is editing this chat.",
        409,
        "composer_busy",
      );
    }

    const leaseToken = randomUUID();
    const expiresAt = expiry(WORKSPACE_CHAT_LEASE_MS);
    await transaction
      .insert(schema.workspaceChatLeases)
      .values({
        workspaceId,
        chatId,
        holderId: userId,
        clientId,
        leaseToken,
        expiresAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.workspaceChatLeases.workspaceId,
          schema.workspaceChatLeases.chatId,
        ],
        set: {
          holderId: userId,
          clientId,
          leaseToken,
          expiresAt,
          updatedAt: now,
        },
      });
    return { leaseToken, expiresAt: expiresAt.toISOString() };
  });
}

async function requireOwnedLease(
  transaction: Parameters<
    Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
  >[0],
  input: {
    workspaceId: string;
    chatId: string;
    userId: string;
    clientId: string;
    leaseToken: string;
  },
) {
  const [lease] = await transaction
    .select()
    .from(schema.workspaceChatLeases)
    .where(
      and(
        eq(schema.workspaceChatLeases.workspaceId, input.workspaceId),
        eq(schema.workspaceChatLeases.chatId, input.chatId),
      ),
    )
    .limit(1);
  if (
    !lease ||
    lease.holderId !== input.userId ||
    lease.clientId !== input.clientId ||
    lease.leaseToken !== input.leaseToken ||
    lease.expiresAt <= new Date()
  ) {
    throw new WorkspaceChatCoordinationError(
      "Composer control expired. Take control again before continuing.",
      409,
      "lease_expired",
    );
  }
  return lease;
}

export async function renewWorkspaceChatLease(input: {
  workspaceId: string;
  chatId: string;
  userId: string;
  clientId: string;
  leaseToken: string;
}) {
  return getDatabase().transaction(async (transaction) => {
    await lockChat(transaction, input.workspaceId, input.chatId);
    await requireOwnedLease(transaction, input);
    const expiresAt = expiry(WORKSPACE_CHAT_LEASE_MS);
    await transaction
      .update(schema.workspaceChatLeases)
      .set({ expiresAt, updatedAt: new Date() })
      .where(
        and(
          eq(schema.workspaceChatLeases.workspaceId, input.workspaceId),
          eq(schema.workspaceChatLeases.chatId, input.chatId),
        ),
      );
    return { expiresAt: expiresAt.toISOString() };
  });
}

export async function releaseWorkspaceChatLease(input: {
  workspaceId: string;
  chatId: string;
  userId: string;
  clientId: string;
  leaseToken: string;
}) {
  return getDatabase().transaction(async (transaction) => {
    await lockChat(transaction, input.workspaceId, input.chatId);
    const [lease] = await transaction
      .select()
      .from(schema.workspaceChatLeases)
      .where(
        and(
          eq(schema.workspaceChatLeases.workspaceId, input.workspaceId),
          eq(schema.workspaceChatLeases.chatId, input.chatId),
        ),
      )
      .limit(1);
    if (
      lease?.holderId === input.userId &&
      lease.clientId === input.clientId &&
      lease.leaseToken === input.leaseToken
    ) {
      await transaction
        .delete(schema.workspaceChatLeases)
        .where(
          and(
            eq(schema.workspaceChatLeases.workspaceId, input.workspaceId),
            eq(schema.workspaceChatLeases.chatId, input.chatId),
          ),
        );
    }
  });
}

export async function recordWorkspaceChatPrompt(input: {
  workspaceId: string;
  chatId: string;
  userId: string;
  clientId: string;
  leaseToken: string;
  clientMessageId: string;
  prompt: string;
  attachments: WorkspaceChatPromptAttachment[];
  provider: string;
  model?: string | null;
  effort?: string | null;
}) {
  return getDatabase().transaction(async (transaction) => {
    await lockChat(transaction, input.workspaceId, input.chatId);
    await requireOwnedLease(transaction, input);
    const expiresAt = expiry(WORKSPACE_CHAT_LEASE_MS);
    const [inserted] = await transaction
      .insert(schema.workspaceChatPromptReceipts)
      .values({
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        authorId: input.userId,
        clientMessageId: input.clientMessageId,
        prompt: input.prompt,
        attachments: input.attachments,
        provider: input.provider,
        model: input.model ?? null,
        effort: input.effort ?? null,
      })
      .onConflictDoNothing({
        target: [
          schema.workspaceChatPromptReceipts.workspaceId,
          schema.workspaceChatPromptReceipts.chatId,
          schema.workspaceChatPromptReceipts.clientMessageId,
        ],
      })
      .returning({ id: schema.workspaceChatPromptReceipts.id });
    await transaction
      .update(schema.workspaceChatLeases)
      .set({ expiresAt, updatedAt: new Date() })
      .where(
        and(
          eq(schema.workspaceChatLeases.workspaceId, input.workspaceId),
          eq(schema.workspaceChatLeases.chatId, input.chatId),
        ),
      );

    if (inserted) return inserted;
    const [existing] = await transaction
      .select({ id: schema.workspaceChatPromptReceipts.id })
      .from(schema.workspaceChatPromptReceipts)
      .where(
        and(
          eq(schema.workspaceChatPromptReceipts.workspaceId, input.workspaceId),
          eq(schema.workspaceChatPromptReceipts.chatId, input.chatId),
          eq(
            schema.workspaceChatPromptReceipts.clientMessageId,
            input.clientMessageId,
          ),
          eq(schema.workspaceChatPromptReceipts.authorId, input.userId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new WorkspaceChatCoordinationError(
        "That prompt identifier is already in use.",
        409,
        "prompt_conflict",
      );
    }
    return existing;
  });
}

export async function loadWorkspaceChatSnapshot(
  workspaceId: string,
  chatId: string,
  viewerId: string,
): Promise<WorkspaceChatSnapshot> {
  const now = new Date();
  const database = getDatabase();
  const [viewerRows, leaseRows, participantRows, receiptRows] =
    await Promise.all([
      database
        .select({
          id: schema.users.id,
          name: schema.users.name,
          login: schema.users.login,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.users)
        .where(eq(schema.users.id, viewerId))
        .limit(1),
      database
        .select({
          holderId: schema.workspaceChatLeases.holderId,
          clientId: schema.workspaceChatLeases.clientId,
          expiresAt: schema.workspaceChatLeases.expiresAt,
          name: schema.users.name,
          login: schema.users.login,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.workspaceChatLeases)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.workspaceChatLeases.holderId),
        )
        .where(
          and(
            eq(schema.workspaceChatLeases.workspaceId, workspaceId),
            eq(schema.workspaceChatLeases.chatId, chatId),
            gt(schema.workspaceChatLeases.expiresAt, now),
          ),
        )
        .limit(1),
      database
        .select({
          id: schema.users.id,
          name: schema.users.name,
          login: schema.users.login,
          avatarUrl: schema.users.avatarUrl,
          updatedAt: schema.workspaceChatParticipants.updatedAt,
        })
        .from(schema.workspaceChatParticipants)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.workspaceChatParticipants.userId),
        )
        .where(
          and(
            eq(schema.workspaceChatParticipants.workspaceId, workspaceId),
            eq(schema.workspaceChatParticipants.chatId, chatId),
            gt(schema.workspaceChatParticipants.expiresAt, now),
          ),
        )
        .orderBy(desc(schema.workspaceChatParticipants.updatedAt)),
      database
        .select({
          id: schema.workspaceChatPromptReceipts.id,
          clientMessageId: schema.workspaceChatPromptReceipts.clientMessageId,
          authorId: schema.workspaceChatPromptReceipts.authorId,
          prompt: schema.workspaceChatPromptReceipts.prompt,
          attachments: schema.workspaceChatPromptReceipts.attachments,
          provider: schema.workspaceChatPromptReceipts.provider,
          model: schema.workspaceChatPromptReceipts.model,
          effort: schema.workspaceChatPromptReceipts.effort,
          createdAt: schema.workspaceChatPromptReceipts.createdAt,
          authorName: schema.users.name,
          authorLogin: schema.users.login,
          authorAvatarUrl: schema.users.avatarUrl,
        })
        .from(schema.workspaceChatPromptReceipts)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.workspaceChatPromptReceipts.authorId),
        )
        .where(
          and(
            eq(schema.workspaceChatPromptReceipts.workspaceId, workspaceId),
            eq(schema.workspaceChatPromptReceipts.chatId, chatId),
          ),
        )
        .orderBy(asc(schema.workspaceChatPromptReceipts.createdAt))
        .limit(200),
    ]);

  const viewerRow = viewerRows[0];
  if (!viewerRow) {
    throw new WorkspaceChatCoordinationError(
      "Workspace member not found.",
      404,
      "member_not_found",
    );
  }
  const seenParticipants = new Set<string>();
  const participants = participantRows.flatMap((row) => {
    if (seenParticipants.has(row.id)) return [];
    seenParticipants.add(row.id);
    return [member(row)];
  });
  const activeLease = leaseRows[0];

  return {
    viewer: member(viewerRow),
    lease: activeLease
      ? {
          holder: member({
            id: activeLease.holderId,
            name: activeLease.name,
            login: activeLease.login,
            avatarUrl: activeLease.avatarUrl,
          }),
          clientId: activeLease.clientId,
          expiresAt: activeLease.expiresAt.toISOString(),
        }
      : null,
    participants,
    receipts: receiptRows.map((receipt) => ({
      id: receipt.id,
      clientMessageId: receipt.clientMessageId,
      author: member({
        id: receipt.authorId,
        name: receipt.authorName,
        login: receipt.authorLogin,
        avatarUrl: receipt.authorAvatarUrl,
      }),
      prompt: receipt.prompt,
      attachments: receipt.attachments,
      provider: receipt.provider,
      model: receipt.model,
      effort: receipt.effort,
      createdAt: receipt.createdAt.toISOString(),
    })),
    serverTime: now.toISOString(),
  };
}
