import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { and, eq, lt } from "drizzle-orm";

import {
  gen2SessionImportPreviewSchema,
  type Gen2SessionImportPreview,
  type Gen2SessionImportProvider,
} from "@codev/contracts";
import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { decryptSecret, encryptSecret } from "../platform/kms";
import { Gen2AccessError } from "./errors";
import { readSessionImport } from "./session-import-parse";
import { requireGen2Member } from "./workspaces";

/**
 * Imports a member's local Codex or Claude Code session as a workspace chat,
 * in two steps: the upload is redacted, parsed, and saved as a draft the
 * member reviews; confirming turns the draft into a chat. Only the importer
 * can see or confirm a draft, and only editors can import.
 */

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const INSERT_BATCH = 500;

type Draft = typeof schema.gen2SessionImports.$inferSelect;

function encryptionContext(importId: string) {
  return { gen2SessionImport: importId };
}

function isImportId(value: string) {
  return gen2SessionImportPreviewSchema.shape.importId.safeParse(value).success;
}

async function requireEditor(workspaceId: string, userId: string) {
  const membership = await requireGen2Member(workspaceId, userId);
  if (membership.role === "viewer") {
    throw new Gen2AccessError("Edit permission is required to import.", 403);
  }
}

export async function previewGen2SessionImport(input: {
  workspaceId: string;
  userId: string;
  provider: Gen2SessionImportProvider;
  bytes: Uint8Array;
}): Promise<Gen2SessionImportPreview> {
  await requireEditor(input.workspaceId, input.userId);
  const { text, session, preview } = readSessionImport(
    input.provider,
    input.bytes,
  );
  const importId = randomUUID();
  const database = getDatabase();
  const [encryptedPayload] = await Promise.all([
    // Rollouts are mostly repetitive JSON and shrink several-fold.
    encryptSecret(
      gzipSync(text).toString("base64"),
      encryptionContext(importId),
    ),
    // Abandoned drafts are cleared whenever their owner starts another.
    database
      .delete(schema.gen2SessionImports)
      .where(
        and(
          eq(schema.gen2SessionImports.importedByUserId, input.userId),
          eq(schema.gen2SessionImports.status, "draft"),
          lt(
            schema.gen2SessionImports.createdAt,
            new Date(Date.now() - DRAFT_TTL_MS),
          ),
        ),
      ),
  ]);
  await database.insert(schema.gen2SessionImports).values({
    id: importId,
    workspaceId: input.workspaceId,
    importedByUserId: input.userId,
    provider: input.provider,
    nativeSessionId: session.nativeSessionId,
    encryptedPayload,
    payloadSha256: createHash("sha256").update(text).digest("hex"),
    payloadBytes: Buffer.byteLength(text),
    meta: { ...preview, sample: [], cwd: session.cwd },
  });
  return gen2SessionImportPreviewSchema.parse({ importId, ...preview });
}

async function requireDraft(
  workspaceId: string,
  userId: string,
  importId: string,
): Promise<Draft> {
  if (!isImportId(importId)) throw new Gen2AccessError("Import not found.");
  const [draft] = await getDatabase()
    .select()
    .from(schema.gen2SessionImports)
    .where(
      and(
        eq(schema.gen2SessionImports.id, importId),
        eq(schema.gen2SessionImports.workspaceId, workspaceId),
        eq(schema.gen2SessionImports.importedByUserId, userId),
        eq(schema.gen2SessionImports.status, "draft"),
      ),
    )
    .limit(1);
  if (!draft) throw new Gen2AccessError("This import has expired.", 404);
  return draft;
}

export async function confirmGen2SessionImport(input: {
  workspaceId: string;
  userId: string;
  importId: string;
  title?: string | undefined;
}) {
  await requireEditor(input.workspaceId, input.userId);
  const draft = await requireDraft(
    input.workspaceId,
    input.userId,
    input.importId,
  );
  const compressed = await decryptSecret(
    draft.encryptedPayload,
    encryptionContext(draft.id),
  );
  const bytes = gunzipSync(Buffer.from(compressed, "base64"));
  const provider = draft.provider as Gen2SessionImportProvider;
  const { session, preview } = readSessionImport(provider, bytes);

  // Original times, nudged to be strictly increasing: the chat orders and
  // de-duplicates messages by creation time.
  let previous = 0;
  const createdAt = session.messages.map((message) => {
    const original = message.createdAt ? Date.parse(message.createdAt) : 0;
    previous = Math.max(original, previous + 1);
    return new Date(previous);
  });

  const chatId = await getDatabase().transaction(async (tx) => {
    const [chat] = await tx
      .insert(schema.gen2Chats)
      .values({
        workspaceId: input.workspaceId,
        createdByUserId: input.userId,
        title: input.title ?? preview.title,
        provider,
      })
      .returning({ id: schema.gen2Chats.id });
    if (!chat) throw new Gen2AccessError("Couldn't create the chat.", 500);
    const rows = session.messages.map((message, index) => ({
      chatId: chat.id,
      role: message.role,
      body: message.body,
      items: message.items,
      createdAt: createdAt[index],
    }));
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      await tx
        .insert(schema.gen2ChatMessages)
        .values(rows.slice(start, start + INSERT_BATCH));
    }
    await tx
      .update(schema.gen2SessionImports)
      .set({ status: "imported", chatId: chat.id, updatedAt: new Date() })
      .where(eq(schema.gen2SessionImports.id, draft.id));
    return chat.id;
  });
  return { chatId };
}

export async function discardGen2SessionImport(input: {
  workspaceId: string;
  userId: string;
  importId: string;
}) {
  await requireGen2Member(input.workspaceId, input.userId);
  if (!isImportId(input.importId)) return;
  await getDatabase()
    .delete(schema.gen2SessionImports)
    .where(
      and(
        eq(schema.gen2SessionImports.id, input.importId),
        eq(schema.gen2SessionImports.workspaceId, input.workspaceId),
        eq(schema.gen2SessionImports.importedByUserId, input.userId),
        eq(schema.gen2SessionImports.status, "draft"),
      ),
    );
}
