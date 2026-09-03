import "server-only";

import { and, asc, count, desc, eq } from "drizzle-orm";

import {
  importedConversationSchema,
  type ImportedConversation,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { createInviteToken, hashInviteToken } from "./crypto";
import { getDatabase } from "./database";
import {
  permissionsForSharedChatRole,
  type SharedChatRole,
} from "./shared-chat-permissions";

const ROOM_INVITE_TTL_MS = 24 * 60 * 60 * 1_000;

export type SharedChatRoom = {
  id: string;
  ownerId: string;
  viewerRole: SharedChatRole;
  createdAt: string;
  members: Array<{
    userId: string;
    name: string | null;
    login: string;
    avatarUrl: string | null;
    role: SharedChatRole;
    joinedAt: string;
  }>;
  conversation: ImportedConversation;
};

export type SharedChatSummary = {
  id: string;
  title: string;
  sourceProvider: string | null;
  messageCount: number;
  updatedAt: Date;
};

export class SharedChatError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SharedChatError";
  }
}

export async function createSharedChatInvite(roomId: string, userId: string) {
  const [room] = await getDatabase()
    .select({ id: schema.sharedChats.id })
    .from(schema.sharedChats)
    .innerJoin(
      schema.sharedChatMembers,
      and(
        eq(schema.sharedChatMembers.sharedChatId, schema.sharedChats.id),
        eq(schema.sharedChatMembers.userId, userId),
        eq(schema.sharedChatMembers.role, "owner"),
      ),
    )
    .where(eq(schema.sharedChats.id, roomId))
    .limit(1);
  if (!room) {
    throw new SharedChatError(
      "Room not found or you cannot invite people to it.",
      404,
    );
  }

  const token = createInviteToken();
  const expiresAt = new Date(Date.now() + ROOM_INVITE_TTL_MS);
  const [invite] = await getDatabase()
    .insert(schema.sharedChatInvites)
    .values({
      sharedChatId: roomId,
      createdBy: userId,
      tokenHash: hashInviteToken(token),
      expiresAt,
    })
    .returning({ id: schema.sharedChatInvites.id });
  if (!invite) throw new Error("The room invite could not be created.");

  return { id: invite.id, token, expiresAt };
}

export async function acceptSharedChatInvite(token: string, userId: string) {
  const tokenHash = hashInviteToken(token);

  return getDatabase().transaction(async (transaction) => {
    const [invite] = await transaction
      .select()
      .from(schema.sharedChatInvites)
      .where(eq(schema.sharedChatInvites.tokenHash, tokenHash))
      .limit(1)
      .for("update");
    if (
      !invite ||
      invite.revokedAt ||
      invite.acceptedAt ||
      invite.expiresAt <= new Date()
    ) {
      throw new SharedChatError(
        "This room invitation is invalid, expired, or already used.",
        400,
      );
    }

    await transaction
      .insert(schema.sharedChatMembers)
      .values({
        sharedChatId: invite.sharedChatId,
        userId,
        role: "member",
      })
      .onConflictDoNothing();
    await transaction
      .update(schema.sharedChatInvites)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(eq(schema.sharedChatInvites.id, invite.id));

    return invite.sharedChatId;
  });
}

export async function postSharedChatMessage({
  roomId,
  userId,
  authorName,
  body,
}: {
  roomId: string;
  userId: string;
  authorName: string;
  body: string;
}) {
  return getDatabase().transaction(async (transaction) => {
    const [room] = await transaction
      .select({
        conversationId: schema.sharedChats.conversationId,
        role: schema.sharedChatMembers.role,
      })
      .from(schema.sharedChats)
      .innerJoin(
        schema.sharedChatMembers,
        and(
          eq(schema.sharedChatMembers.sharedChatId, schema.sharedChats.id),
          eq(schema.sharedChatMembers.userId, userId),
        ),
      )
      .where(eq(schema.sharedChats.id, roomId))
      .limit(1)
      .for("update");

    if (!room) throw new SharedChatError("Room not found.", 404);
    if (!permissionsForSharedChatRole(room.role).post) {
      throw new SharedChatError("You cannot post messages in this room.", 403);
    }

    const [lastMessage] = await transaction
      .select({ sequence: schema.conversationMessages.sequence })
      .from(schema.conversationMessages)
      .where(
        eq(schema.conversationMessages.conversationId, room.conversationId),
      )
      .orderBy(desc(schema.conversationMessages.sequence))
      .limit(1);
    const sequence = (lastMessage?.sequence ?? -1) + 1;
    const now = new Date();
    const [message] = await transaction
      .insert(schema.conversationMessages)
      .values({
        conversationId: room.conversationId,
        sequence,
        role: "user",
        authorUserId: userId,
        authorName,
        body,
        sourceContentType: "text",
        sourceCreatedAt: now,
      })
      .returning({
        id: schema.conversationMessages.id,
        sequence: schema.conversationMessages.sequence,
        body: schema.conversationMessages.body,
        createdAt: schema.conversationMessages.sourceCreatedAt,
      });
    if (!message) {
      throw new Error("The room message could not be created.");
    }

    await transaction
      .update(schema.sharedChats)
      .set({ updatedAt: now })
      .where(eq(schema.sharedChats.id, roomId));

    return {
      ...message,
      authorName,
      createdAt: message.createdAt?.toISOString() ?? now.toISOString(),
    };
  });
}

export async function listSharedChatsForUser(
  userId: string,
): Promise<SharedChatSummary[]> {
  return getDatabase()
    .select({
      id: schema.sharedChats.id,
      title: schema.conversations.title,
      sourceProvider: schema.conversations.sourceProvider,
      messageCount: count(schema.conversationMessages.id).mapWith(Number),
      updatedAt: schema.sharedChats.updatedAt,
    })
    .from(schema.sharedChatMembers)
    .innerJoin(
      schema.sharedChats,
      eq(schema.sharedChats.id, schema.sharedChatMembers.sharedChatId),
    )
    .innerJoin(
      schema.conversations,
      eq(schema.conversations.id, schema.sharedChats.conversationId),
    )
    .leftJoin(
      schema.conversationMessages,
      eq(schema.conversationMessages.conversationId, schema.conversations.id),
    )
    .where(eq(schema.sharedChatMembers.userId, userId))
    .groupBy(
      schema.sharedChats.id,
      schema.conversations.title,
      schema.conversations.sourceProvider,
    )
    .orderBy(desc(schema.sharedChats.updatedAt));
}

export async function createSharedChatFromImportedConversation(
  ownerId: string,
  input: ImportedConversation,
) {
  const conversation = importedConversationSchema.parse(input);

  return getDatabase().transaction(async (transaction) => {
    const [createdConversation] = await transaction
      .insert(schema.conversations)
      .values({
        ownerId,
        kind: "imported",
        title: conversation.title,
        sourceProvider: conversation.source.provider,
        sourceExternalId: conversation.source.externalId,
        sourceUrl: conversation.source.url,
        sourceModel: conversation.source.model,
        sourceUpdatedAt: conversation.source.updatedAt
          ? new Date(conversation.source.updatedAt)
          : null,
        warnings: conversation.warnings,
      })
      .onConflictDoNothing({
        target: [
          schema.conversations.ownerId,
          schema.conversations.sourceProvider,
          schema.conversations.sourceExternalId,
        ],
      })
      .returning({ id: schema.conversations.id });

    if (!createdConversation) {
      const [existing] = await transaction
        .select({
          conversationId: schema.conversations.id,
          roomId: schema.sharedChats.id,
        })
        .from(schema.conversations)
        .innerJoin(
          schema.sharedChats,
          eq(schema.sharedChats.conversationId, schema.conversations.id),
        )
        .where(
          and(
            eq(schema.conversations.ownerId, ownerId),
            eq(
              schema.conversations.sourceProvider,
              conversation.source.provider,
            ),
            eq(
              schema.conversations.sourceExternalId,
              conversation.source.externalId,
            ),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new Error(
          "The existing imported conversation could not be found.",
        );
      }
      return { ...existing, created: false };
    }

    const insertedMessages = await transaction
      .insert(schema.conversationMessages)
      .values(
        conversation.messages.map((message) => ({
          conversationId: createdConversation.id,
          sequence: message.sequence,
          role: message.role,
          authorName: message.authorName,
          body: message.text,
          sourceContentType: message.sourceContentType,
          sourceCreatedAt: message.createdAt
            ? new Date(message.createdAt)
            : null,
        })),
      )
      .returning({
        id: schema.conversationMessages.id,
        sequence: schema.conversationMessages.sequence,
      });
    const messageIdBySequence = new Map(
      insertedMessages.map((message) => [message.sequence, message.id]),
    );

    const artifacts = conversation.messages.flatMap((message) =>
      message.artifacts.map((artifact) => ({
        conversationId: createdConversation.id,
        messageId: messageIdBySequence.get(message.sequence) ?? null,
        kind: artifact.kind,
        name: artifact.filename,
        sourceUrl: artifact.sourceUrl,
        description: artifact.description,
        downloadable: artifact.downloadable,
      })),
    );
    if (artifacts.length > 0) {
      await transaction.insert(schema.conversationArtifacts).values(artifacts);
    }

    const [room] = await transaction
      .insert(schema.sharedChats)
      .values({ conversationId: createdConversation.id, ownerId })
      .returning({ id: schema.sharedChats.id });
    if (!room) throw new Error("The collaborative room could not be created.");

    await transaction.insert(schema.sharedChatMembers).values({
      sharedChatId: room.id,
      userId: ownerId,
      role: "owner",
    });

    return {
      roomId: room.id,
      conversationId: createdConversation.id,
      created: true,
    };
  });
}

export async function getSharedChatRoom(
  roomId: string,
  viewerId: string,
): Promise<SharedChatRoom | null> {
  const database = getDatabase();
  const [room] = await database
    .select({
      id: schema.sharedChats.id,
      ownerId: schema.sharedChats.ownerId,
      viewerRole: schema.sharedChatMembers.role,
      createdAt: schema.sharedChats.createdAt,
      conversationId: schema.conversations.id,
      title: schema.conversations.title,
      sourceProvider: schema.conversations.sourceProvider,
      sourceExternalId: schema.conversations.sourceExternalId,
      sourceUrl: schema.conversations.sourceUrl,
      sourceModel: schema.conversations.sourceModel,
      sourceUpdatedAt: schema.conversations.sourceUpdatedAt,
      warnings: schema.conversations.warnings,
    })
    .from(schema.sharedChats)
    .innerJoin(
      schema.sharedChatMembers,
      and(
        eq(schema.sharedChatMembers.sharedChatId, schema.sharedChats.id),
        eq(schema.sharedChatMembers.userId, viewerId),
      ),
    )
    .innerJoin(
      schema.conversations,
      eq(schema.conversations.id, schema.sharedChats.conversationId),
    )
    .where(eq(schema.sharedChats.id, roomId))
    .limit(1);
  if (
    !room ||
    !room.sourceProvider ||
    !room.sourceExternalId ||
    !room.sourceUrl
  ) {
    return null;
  }

  const [messages, artifacts, members] = await Promise.all([
    database
      .select({
        id: schema.conversationMessages.id,
        sequence: schema.conversationMessages.sequence,
        role: schema.conversationMessages.role,
        authorName: schema.conversationMessages.authorName,
        body: schema.conversationMessages.body,
        sourceContentType: schema.conversationMessages.sourceContentType,
        sourceCreatedAt: schema.conversationMessages.sourceCreatedAt,
      })
      .from(schema.conversationMessages)
      .where(
        eq(schema.conversationMessages.conversationId, room.conversationId),
      )
      .orderBy(asc(schema.conversationMessages.sequence)),
    database
      .select({
        messageId: schema.conversationArtifacts.messageId,
        kind: schema.conversationArtifacts.kind,
        sourceUrl: schema.conversationArtifacts.sourceUrl,
        filename: schema.conversationArtifacts.name,
        description: schema.conversationArtifacts.description,
        downloadable: schema.conversationArtifacts.downloadable,
      })
      .from(schema.conversationArtifacts)
      .where(
        eq(schema.conversationArtifacts.conversationId, room.conversationId),
      ),
    database
      .select({
        userId: schema.sharedChatMembers.userId,
        name: schema.users.name,
        login: schema.users.login,
        avatarUrl: schema.users.avatarUrl,
        role: schema.sharedChatMembers.role,
        joinedAt: schema.sharedChatMembers.joinedAt,
      })
      .from(schema.sharedChatMembers)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.sharedChatMembers.userId),
      )
      .where(eq(schema.sharedChatMembers.sharedChatId, room.id))
      .orderBy(asc(schema.sharedChatMembers.joinedAt)),
  ]);
  const artifactsByMessage = new Map<string, typeof artifacts>();
  for (const artifact of artifacts) {
    if (!artifact.messageId) continue;
    const current = artifactsByMessage.get(artifact.messageId) ?? [];
    current.push(artifact);
    artifactsByMessage.set(artifact.messageId, current);
  }

  const persistedConversation = importedConversationSchema.parse({
    source: {
      provider: room.sourceProvider,
      externalId: room.sourceExternalId,
      url: room.sourceUrl,
      model: room.sourceModel,
      updatedAt: room.sourceUpdatedAt?.toISOString() ?? null,
    },
    title: room.title,
    messages: messages.map((message) => ({
      sequence: message.sequence,
      role: message.role,
      authorName: message.authorName,
      text: message.body,
      sourceContentType: message.sourceContentType,
      createdAt: message.sourceCreatedAt?.toISOString() ?? null,
      artifacts: (artifactsByMessage.get(message.id) ?? []).map((artifact) => ({
        kind: artifact.kind,
        sourceUrl: artifact.sourceUrl,
        filename: artifact.filename,
        description: artifact.description,
        downloadable: artifact.downloadable,
      })),
    })),
    warnings: room.warnings,
  });

  return {
    id: room.id,
    ownerId: room.ownerId,
    viewerRole: room.viewerRole === "owner" ? "owner" : "member",
    createdAt: room.createdAt.toISOString(),
    members: members.map((member) => ({
      ...member,
      role: member.role === "owner" ? "owner" : "member",
      joinedAt: member.joinedAt.toISOString(),
    })),
    conversation: persistedConversation,
  };
}
