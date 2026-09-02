import "server-only";

import { and, asc, count, desc, eq } from "drizzle-orm";

import {
  importedConversationSchema,
  type ImportedConversation,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { getDatabase } from "./database";

export type SharedChatRoom = {
  id: string;
  ownerId: string;
  viewerRole: string;
  createdAt: string;
  conversation: ImportedConversation;
};

export type SharedChatSummary = {
  id: string;
  title: string;
  sourceProvider: string | null;
  messageCount: number;
  updatedAt: Date;
};

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

  const [messages, artifacts] = await Promise.all([
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
    viewerRole: room.viewerRole,
    createdAt: room.createdAt.toISOString(),
    conversation: persistedConversation,
  };
}
