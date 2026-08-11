import "server-only";

import { randomUUID } from "node:crypto";

import {
  collaborationClientMessageSchema,
  collaborationPresenceEntrySchema,
  collaborationServerMessageSchema,
  conflictResolutionInputSchema,
  presenceCursorSchema,
  type ConflictResolutionInput,
  type CollaborationPresenceEntry,
  type CollaborationServerMessage,
  type CollaborationUser,
} from "@codev/contracts";
import { readServerEnvironment } from "@codev/config";
import { schema } from "@codev/db";
import { and, eq } from "drizzle-orm";
import Redis from "ioredis";
import type { RawData, WebSocket } from "ws";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

import { getDatabase } from "@/lib/database";
import { readSandboxFile, writeSandboxFile } from "@/lib/orchestrator";
import { appendPresenceEvent } from "@/lib/presence-events";

const MAX_SOCKET_PAYLOAD_BYTES = 128 * 1_024;
const HEARTBEAT_INTERVAL_MS = 20_000;
const PRESENCE_TTL_MS = 60_000;
const STREAM_MAX_LENGTH = 2_000;
const REPLAY_LIMIT = 250;
const LOCK_TTL_MS = 75_000;
const INSTANCE_ID = randomUUID();

interface Connection {
  id: string;
  socket: WebSocket;
  user: CollaborationUser;
  joined: boolean;
  worktreeId: string | null;
  subscriptions: Set<string>;
  activePath: string | null;
  cursor: { anchor: number; head: number } | null;
  resumeFrom: string | null;
  replayedPaths: Set<string>;
  alive: boolean;
  canEdit: boolean;
}

interface LocalRoom {
  connections: Set<Connection>;
  cursor: string;
  reader: Redis;
  polling: boolean;
}

interface Snapshot {
  worktreeId: string;
  path: string;
  revision: string;
  update: string;
  stateVector: string;
  filesystemContents: string;
  filesystemRevision: string | null;
  hasConflict: boolean;
  conflictFilesystemRevision: string | null;
}

export function classifyFilesystemReconciliation(input: {
  snapshotContents: string;
  collaborativeContents: string;
  snapshotRevision: string;
  filesystemRevision: string;
}) {
  if (input.snapshotRevision === input.filesystemRevision) {
    return "unchanged" as const;
  }
  return input.collaborativeContents === input.snapshotContents
    ? ("ingest" as const)
    : ("conflict" as const);
}

type StreamEvent = Extract<
  CollaborationServerMessage,
  { type: "update" | "awareness" | "reconciled" | "conflict" }
>;

const localRooms = new Map<string, LocalRoom>();
let redis: Redis | undefined;

function redisClient() {
  if (!redis) {
    const url = readServerEnvironment().REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL is required for realtime collaboration.");
    }
    redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
  }
  return redis;
}

function streamKey(workspaceId: string) {
  return `codev:collaboration:${workspaceId}:events`;
}

function presenceHashKey(workspaceId: string) {
  return `codev:collaboration:${workspaceId}:presence`;
}

function presenceExpiryKey(workspaceId: string) {
  return `codev:collaboration:${workspaceId}:presence-expiry`;
}

/**
 * Returns the distinct people with an active collaboration connection. This
 * is intentionally separate from workspace membership: a member appears in
 * this list only while their realtime presence heartbeat is current.
 */
export async function listWorkspacePresence(workspaceId: string) {
  try {
    const client = redisClient();
    if (client.status === "wait") await client.connect();
    const values = await client.hvals(presenceHashKey(workspaceId));
    const people = new Map<string, CollaborationPresenceEntry>();

    for (const value of values) {
      try {
        const parsed = collaborationPresenceEntrySchema.safeParse(
          JSON.parse(value),
        );
        if (!parsed.success) continue;
        const current = people.get(parsed.data.user.id);
        if (
          !current ||
          parsed.data.lastSeenAt.localeCompare(current.lastSeenAt) > 0
        ) {
          people.set(parsed.data.user.id, parsed.data);
        }
      } catch {
        // A stale or malformed presence record must not block the dashboard.
      }
    }

    return [...people.values()]
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 5)
      .map((entry) => entry.user);
  } catch {
    // Presence is an enhancement. An unavailable realtime service simply
    // leaves the preview in its neutral state.
    return [];
  }
}

function documentLockKey(
  workspaceId: string,
  worktreeId: string,
  path: string,
) {
  return `codev:collaboration:${workspaceId}:${worktreeId}:lock:${Buffer.from(path).toString("base64url")}`;
}

function send(connection: Connection, message: CollaborationServerMessage) {
  if (connection.socket.readyState !== connection.socket.OPEN) return;
  const payload = collaborationServerMessageSchema.parse(message);
  connection.socket.send(JSON.stringify(payload));
}

function sendError(
  connection: Connection,
  code: Extract<CollaborationServerMessage, { type: "error" }>["code"],
  message: string,
  retryable: boolean,
  path?: string,
) {
  send(connection, { type: "error", code, message, retryable, path });
}

function broadcastLocal(
  workspaceId: string,
  message: CollaborationServerMessage,
  except?: Connection,
) {
  const room = localRooms.get(workspaceId);
  if (!room) return;
  for (const connection of room.connections) {
    if (connection !== except && shouldReceive(connection, message)) {
      send(connection, message);
    }
  }
}

function shouldReceive(
  connection: Connection,
  message: CollaborationServerMessage,
) {
  return (
    !("path" in message) ||
    message.type === "error" ||
    (connection.subscriptions.has(message.path) &&
      (!("worktreeId" in message) ||
        connection.worktreeId === message.worktreeId))
  );
}

function parseStreamResult(result: unknown) {
  if (!Array.isArray(result)) return [];
  const events: Array<{
    id: string;
    instance: string | null;
    message: StreamEvent;
  }> = [];
  for (const stream of result) {
    if (!Array.isArray(stream) || !Array.isArray(stream[1])) continue;
    for (const entry of stream[1]) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      const fields = entry[1];
      if (!Array.isArray(fields)) continue;
      const payloadIndex = fields.indexOf("payload");
      const instanceIndex = fields.indexOf("instance");
      if (payloadIndex < 0 || typeof fields[payloadIndex + 1] !== "string") {
        continue;
      }
      try {
        const parsed = collaborationServerMessageSchema.parse(
          JSON.parse(fields[payloadIndex + 1]),
        );
        if (
          parsed.type === "update" ||
          parsed.type === "awareness" ||
          parsed.type === "reconciled" ||
          parsed.type === "conflict"
        ) {
          const message =
            parsed.type === "update" || parsed.type === "awareness"
              ? { ...parsed, streamId: entry[0] }
              : parsed;
          events.push({
            id: entry[0],
            instance:
              instanceIndex >= 0 &&
              typeof fields[instanceIndex + 1] === "string"
                ? fields[instanceIndex + 1]
                : null,
            message,
          });
        }
      } catch {
        // Ignore malformed stream entries; clients must never receive them.
      }
    }
  }
  return events;
}

async function startRoom(workspaceId: string) {
  const existing = localRooms.get(workspaceId);
  if (existing) return existing;

  const client = redisClient();
  if (client.status === "wait") await client.connect();
  const latest = await client.xrevrange(
    streamKey(workspaceId),
    "+",
    "-",
    "COUNT",
    1,
  );
  const room: LocalRoom = {
    connections: new Set(),
    cursor: latest[0]?.[0] ?? "0-0",
    reader: client.duplicate(),
    polling: true,
  };
  localRooms.set(workspaceId, room);
  void pollRoom(workspaceId, room);
  return room;
}

async function pollRoom(workspaceId: string, room: LocalRoom) {
  try {
    if (room.reader.status === "wait") await room.reader.connect();
    while (room.polling) {
      const result = await room.reader.call(
        "XREAD",
        "BLOCK",
        5_000,
        "COUNT",
        100,
        "STREAMS",
        streamKey(workspaceId),
        room.cursor,
      );
      for (const event of parseStreamResult(result)) {
        room.cursor = event.id;
        if (event.instance !== INSTANCE_ID) {
          broadcastLocal(workspaceId, event.message);
        }
      }
    }
  } catch {
    if (room.polling) {
      setTimeout(() => void pollRoom(workspaceId, room), 1_000).unref();
    }
  }
}

async function publish(workspaceId: string, message: StreamEvent) {
  const client = redisClient();
  const streamId = await client.xadd(
    streamKey(workspaceId),
    "MAXLEN",
    "~",
    STREAM_MAX_LENGTH,
    "*",
    "instance",
    INSTANCE_ID,
    "payload",
    JSON.stringify(message),
  );
  broadcastLocal(workspaceId, message);
  return streamId ?? "0-0";
}

async function replay(
  workspaceId: string,
  connection: Connection,
  resumeFrom: string,
  path: string,
) {
  const entries = await redisClient().xrange(
    streamKey(workspaceId),
    `(${resumeFrom}`,
    "+",
    "COUNT",
    REPLAY_LIMIT,
  );
  const events = parseStreamResult([[streamKey(workspaceId), entries]]);
  for (const event of events) {
    if (
      "path" in event.message &&
      event.message.path === path &&
      (!("worktreeId" in event.message) ||
        event.message.worktreeId === connection.worktreeId)
    )
      send(connection, event.message);
  }
}

async function withDocumentLock<T>(
  workspaceId: string,
  worktreeId: string,
  path: string,
  callback: () => Promise<T>,
) {
  const key = documentLockKey(workspaceId, worktreeId, path);
  const token = randomUUID();
  const client = redisClient();
  const acquired = await client.set(key, token, "PX", LOCK_TTL_MS, "NX");
  if (!acquired) throw new Error("Document is busy; retry the update.");
  try {
    return await callback();
  } finally {
    await client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      1,
      key,
      token,
    );
  }
}

function decodeBase64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function encodeBase64(value: Uint8Array) {
  return Buffer.from(value).toString("base64");
}

function docFromUpdate(update: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decodeBase64(update), "snapshot");
  return doc;
}

function replaceDocumentContents(doc: Y.Doc, contents: string) {
  const text = doc.getText("content");
  doc.transact(() => {
    text.delete(0, text.length);
    text.insert(0, contents);
  }, "filesystem");
}

function encodedDocument(doc: Y.Doc) {
  return {
    update: encodeBase64(Y.encodeStateAsUpdate(doc)),
    stateVector: encodeBase64(Y.encodeStateVector(doc)),
  };
}

async function resolveWorktree(workspaceId: string, requested?: string) {
  const conditions = [
    eq(schema.worktrees.workspaceId, workspaceId),
    eq(schema.worktrees.status, "active"),
  ];
  if (requested) conditions.push(eq(schema.worktrees.id, requested));
  else conditions.push(eq(schema.worktrees.kind, "integration"));

  const [worktree] = await getDatabase()
    .select({ id: schema.worktrees.id })
    .from(schema.worktrees)
    .where(and(...conditions))
    .limit(1);
  return worktree?.id ?? null;
}

async function sandboxWorktreeScope(worktreeId: string) {
  const [worktree] = await getDatabase()
    .select({ kind: schema.worktrees.kind })
    .from(schema.worktrees)
    .where(eq(schema.worktrees.id, worktreeId))
    .limit(1);
  if (!worktree) throw new Error("Worktree not found.");
  return worktree.kind === "agent" ? worktreeId : undefined;
}

async function loadSnapshot(worktreeId: string, path: string) {
  const [snapshot] = await getDatabase()
    .select({
      worktreeId: schema.yjsSnapshots.worktreeId,
      path: schema.yjsSnapshots.path,
      revision: schema.yjsSnapshots.revision,
      update: schema.yjsSnapshots.update,
      stateVector: schema.yjsSnapshots.stateVector,
      filesystemContents: schema.yjsSnapshots.filesystemContents,
      filesystemRevision: schema.yjsSnapshots.filesystemRevision,
      hasConflict: schema.yjsSnapshots.hasConflict,
      conflictFilesystemRevision:
        schema.yjsSnapshots.conflictFilesystemRevision,
    })
    .from(schema.yjsSnapshots)
    .where(
      and(
        eq(schema.yjsSnapshots.worktreeId, worktreeId),
        eq(schema.yjsSnapshots.path, path),
      ),
    )
    .limit(1);
  return snapshot ?? null;
}

async function saveSnapshot(
  snapshot: Snapshot,
  conflictFilesystemRevision: string | null = null,
) {
  const now = new Date();
  await getDatabase()
    .insert(schema.yjsSnapshots)
    .values({
      ...snapshot,
      lastSyncedAt: conflictFilesystemRevision ? null : now,
      hasConflict: Boolean(conflictFilesystemRevision),
      conflictFilesystemRevision,
      conflictDetectedAt: conflictFilesystemRevision ? now : null,
      conflictResolvedAt: null,
      conflictResolvedBy: null,
      conflictResolution: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.yjsSnapshots.worktreeId, schema.yjsSnapshots.path],
      set: {
        revision: snapshot.revision,
        update: snapshot.update,
        stateVector: snapshot.stateVector,
        filesystemContents: snapshot.filesystemContents,
        filesystemRevision: snapshot.filesystemRevision,
        lastSyncedAt: conflictFilesystemRevision ? null : now,
        hasConflict: Boolean(conflictFilesystemRevision),
        conflictFilesystemRevision,
        conflictDetectedAt: conflictFilesystemRevision ? now : null,
        conflictResolvedAt: null,
        conflictResolvedBy: null,
        conflictResolution: null,
        updatedAt: now,
      },
    });
}

async function initializeSnapshot(
  workspaceId: string,
  worktreeId: string,
  path: string,
) {
  const file = await readSandboxFile(
    workspaceId,
    path,
    await sandboxWorktreeScope(worktreeId),
  );
  const doc = new Y.Doc();
  doc.getText("content").insert(0, file.contents);
  const encoded = encodedDocument(doc);
  const snapshot: Snapshot = {
    worktreeId,
    path,
    revision: file.revision,
    ...encoded,
    filesystemContents: file.contents,
    filesystemRevision: file.revision,
    hasConflict: false,
    conflictFilesystemRevision: null,
  };
  await saveSnapshot(snapshot);
  return snapshot;
}

async function reconcileSnapshot(workspaceId: string, snapshot: Snapshot) {
  const file = await readSandboxFile(
    workspaceId,
    snapshot.path,
    await sandboxWorktreeScope(snapshot.worktreeId),
  );
  const previousRevision = snapshot.filesystemRevision ?? snapshot.revision;
  if (snapshot.hasConflict) {
    return {
      snapshot,
      event: {
        type: "conflict" as const,
        worktreeId: snapshot.worktreeId,
        path: snapshot.path,
        snapshotRevision: snapshot.revision,
        filesystemRevision:
          snapshot.conflictFilesystemRevision ?? file.revision,
        message:
          "The collaborative document and sandbox file both changed. Neither version was overwritten.",
      },
    };
  }
  const doc = docFromUpdate(snapshot.update);
  const reconciliation = classifyFilesystemReconciliation({
    snapshotContents: snapshot.filesystemContents,
    collaborativeContents: doc.getText("content").toString(),
    snapshotRevision: previousRevision,
    filesystemRevision: file.revision,
  });
  if (reconciliation === "unchanged") {
    return { snapshot, event: null };
  }

  if (reconciliation === "conflict") {
    await saveSnapshot(snapshot, file.revision);
    return {
      snapshot,
      event: {
        type: "conflict" as const,
        worktreeId: snapshot.worktreeId,
        path: snapshot.path,
        snapshotRevision: previousRevision,
        filesystemRevision: file.revision,
        message:
          "The collaborative document and sandbox file both changed. Neither version was overwritten.",
      },
    };
  }

  replaceDocumentContents(doc, file.contents);
  const encoded = encodedDocument(doc);
  const reconciled: Snapshot = {
    ...snapshot,
    ...encoded,
    revision: file.revision,
    filesystemRevision: file.revision,
    filesystemContents: file.contents,
    hasConflict: false,
    conflictFilesystemRevision: null,
  };
  await saveSnapshot(reconciled);
  return {
    snapshot: reconciled,
    event: {
      type: "reconciled" as const,
      worktreeId: snapshot.worktreeId,
      path: snapshot.path,
      revision: file.revision,
      source: "filesystem" as const,
      update: encoded.update,
    },
  };
}

async function subscribe(
  workspaceId: string,
  connection: Connection,
  path: string,
  stateVector?: string,
) {
  if (!connection.worktreeId) {
    sendError(
      connection,
      "not_joined",
      "Join the workspace first.",
      false,
      path,
    );
    return;
  }

  const previousPath = connection.activePath;

  const result = await withDocumentLock(
    workspaceId,
    connection.worktreeId,
    path,
    async () => {
      const loaded =
        (await loadSnapshot(connection.worktreeId!, path)) ??
        (await initializeSnapshot(workspaceId, connection.worktreeId!, path));
      return reconcileSnapshot(workspaceId, loaded);
    },
  );
  connection.subscriptions.add(path);
  connection.activePath = path;
  if (result.event?.type === "reconciled") {
    await publish(workspaceId, result.event);
  }
  if (connection.resumeFrom && !connection.replayedPaths.has(path)) {
    connection.replayedPaths.add(path);
    await replay(workspaceId, connection, connection.resumeFrom, path);
  }

  const doc = docFromUpdate(result.snapshot.update);
  const update = stateVector
    ? Y.encodeStateAsUpdate(doc, decodeBase64(stateVector))
    : Y.encodeStateAsUpdate(doc);
  send(connection, {
    type: "sync",
    path,
    update: encodeBase64(update),
    stateVector: encodeBase64(Y.encodeStateVector(doc)),
    revision: result.snapshot.revision,
  });
  if (result.event?.type === "conflict") {
    await publish(workspaceId, result.event);
  }
  await refreshPresence(workspaceId, connection);
  if (previousPath !== path) {
    await appendPresenceEvent({
      workspaceId,
      type: "presence.active_file.changed",
      data: {
        userId: connection.user.id,
        path,
        previousPath,
      },
    });
  }
}

async function applyDocumentUpdate(
  workspaceId: string,
  connection: Connection,
  path: string,
  update: string,
) {
  if (!connection.worktreeId || !connection.subscriptions.has(path)) {
    sendError(
      connection,
      connection.worktreeId ? "not_subscribed" : "not_joined",
      "Subscribe to the document before updating it.",
      false,
      path,
    );
    return;
  }

  const outcome = await withDocumentLock(
    workspaceId,
    connection.worktreeId,
    path,
    async () => {
      const loaded = await loadSnapshot(connection.worktreeId!, path);
      if (!loaded) throw new Error("The collaboration snapshot was not found.");
      const reconciled = await reconcileSnapshot(workspaceId, loaded);
      if (reconciled.event?.type === "reconciled") {
        await publish(workspaceId, reconciled.event);
      }

      const doc = docFromUpdate(reconciled.snapshot.update);
      Y.applyUpdate(doc, decodeBase64(update), "client");
      const contents = doc.getText("content").toString();
      const sandboxWorktreeId = await sandboxWorktreeScope(
        connection.worktreeId!,
      );
      if (reconciled.event) {
        const encoded = encodedDocument(doc);
        const filesystemRevision =
          reconciled.event.type === "conflict"
            ? reconciled.event.filesystemRevision
            : (reconciled.snapshot.filesystemRevision ??
              reconciled.snapshot.revision);
        await saveSnapshot(
          {
            ...reconciled.snapshot,
            ...encoded,
            hasConflict: true,
            conflictFilesystemRevision: filesystemRevision,
          },
          filesystemRevision,
        );
        return {
          event: {
            type: "conflict" as const,
            worktreeId: connection.worktreeId!,
            path,
            snapshotRevision: loaded.revision,
            filesystemRevision,
            message:
              "A collaborative edit arrived concurrently with a sandbox file change. Neither version was overwritten.",
          },
          updateEvent: null,
        };
      }
      try {
        const written = await writeSandboxFile(workspaceId, {
          path,
          contents,
          expectedRevision:
            reconciled.snapshot.filesystemRevision ??
            reconciled.snapshot.revision,
          ...(sandboxWorktreeId ? { worktreeId: sandboxWorktreeId } : {}),
        });
        const encoded = encodedDocument(doc);
        await saveSnapshot({
          ...reconciled.snapshot,
          ...encoded,
          revision: written.revision,
          filesystemRevision: written.revision,
          filesystemContents: contents,
          hasConflict: false,
          conflictFilesystemRevision: null,
        });
        return {
          event: null,
          updateEvent: {
            type: "update" as const,
            worktreeId: connection.worktreeId!,
            path,
            update,
            revision: written.revision,
            actorId: connection.user.id,
            streamId: "pending",
          },
        };
      } catch {
        const latest = await readSandboxFile(
          workspaceId,
          path,
          sandboxWorktreeId,
        );
        const encoded = encodedDocument(doc);
        await saveSnapshot(
          {
            ...reconciled.snapshot,
            ...encoded,
          },
          latest.revision,
        );
        return {
          event: {
            type: "conflict" as const,
            worktreeId: connection.worktreeId!,
            path,
            snapshotRevision: reconciled.snapshot.revision,
            filesystemRevision: latest.revision,
            message:
              "The sandbox file changed while the collaborative update was being saved. Neither version was overwritten.",
          },
          updateEvent: null,
        };
      }
    },
  );

  if (outcome.event) {
    await publish(workspaceId, outcome.event);
    return;
  }
  if (outcome.updateEvent) {
    const streamId = await redisClient().xadd(
      streamKey(workspaceId),
      "MAXLEN",
      "~",
      STREAM_MAX_LENGTH,
      "*",
      "instance",
      INSTANCE_ID,
      "payload",
      JSON.stringify(outcome.updateEvent),
    );
    broadcastLocal(workspaceId, {
      ...outcome.updateEvent,
      streamId: streamId ?? "0-0",
    });
  }
}

function sanitizeAwareness(update: string, user: CollaborationUser) {
  const awareness = new Awareness(new Y.Doc());
  let clientIds: number[] = [];
  let cursor: { anchor: number; head: number } | null = null;
  awareness.on(
    "update",
    (changes: { added: number[]; updated: number[]; removed: number[] }) => {
      clientIds = [
        ...changes.added,
        ...changes.updated,
        ...changes.removed,
      ].filter((clientId) => clientId !== awareness.clientID);
    },
  );
  applyAwarenessUpdate(awareness, decodeBase64(update), "client");
  for (const clientId of clientIds) {
    const state = awareness.states.get(clientId);
    if (state) {
      const parsedCursor = presenceCursorSchema.safeParse(state.cursor);
      if (parsedCursor.success) cursor = parsedCursor.data;
      awareness.states.set(clientId, {
        ...state,
        user: {
          id: user.id,
          login: user.login,
          name: user.name,
          image: user.avatarUrl,
        },
      });
    }
  }
  return {
    update: encodeBase64(encodeAwarenessUpdate(awareness, clientIds)),
    cursor,
  };
}

async function publishAwareness(
  workspaceId: string,
  connection: Connection,
  path: string,
  update: string,
) {
  if (!connection.subscriptions.has(path)) {
    sendError(
      connection,
      "not_subscribed",
      "Subscribe before publishing awareness.",
      false,
      path,
    );
    return;
  }
  connection.activePath = path;
  const sanitized = sanitizeAwareness(update, connection.user);
  const cleanUpdate = sanitized.update;
  const event = {
    type: "awareness" as const,
    worktreeId: connection.worktreeId!,
    path,
    update: cleanUpdate,
    actorId: connection.user.id,
    connectionId: connection.id,
    streamId: "pending",
  };
  const streamId = await redisClient().xadd(
    streamKey(workspaceId),
    "MAXLEN",
    "~",
    STREAM_MAX_LENGTH,
    "*",
    "instance",
    INSTANCE_ID,
    "payload",
    JSON.stringify(event),
  );
  broadcastLocal(
    workspaceId,
    { ...event, streamId: streamId ?? "0-0" },
    connection,
  );
  await refreshPresence(workspaceId, connection);
  if (
    sanitized.cursor &&
    (connection.cursor?.anchor !== sanitized.cursor.anchor ||
      connection.cursor?.head !== sanitized.cursor.head)
  ) {
    connection.cursor = sanitized.cursor;
    await appendPresenceEvent({
      workspaceId,
      type: "presence.cursor.changed",
      data: {
        userId: connection.user.id,
        path,
        cursor: sanitized.cursor,
      },
    });
  }
}

async function refreshPresence(workspaceId: string, connection: Connection) {
  if (!connection.joined) return;
  const entry: CollaborationPresenceEntry = {
    connectionId: connection.id,
    user: connection.user,
    path: connection.activePath,
    lastSeenAt: new Date().toISOString(),
  };
  const now = Date.now();
  const hashKey = presenceHashKey(workspaceId);
  const expiryKey = presenceExpiryKey(workspaceId);
  const client = redisClient();
  const expired = await client.zrangebyscore(expiryKey, 0, now);
  const transaction = client.multi();
  if (expired.length) transaction.hdel(hashKey, ...expired);
  transaction.zremrangebyscore(expiryKey, 0, now);
  transaction.hset(hashKey, connection.id, JSON.stringify(entry));
  transaction.zadd(expiryKey, now + PRESENCE_TTL_MS, connection.id);
  transaction.pexpire(hashKey, PRESENCE_TTL_MS * 2);
  transaction.pexpire(expiryKey, PRESENCE_TTL_MS * 2);
  await transaction.exec();
  await broadcastPresence(workspaceId);
}

async function removePresence(workspaceId: string, connection: Connection) {
  await redisClient()
    .multi()
    .hdel(presenceHashKey(workspaceId), connection.id)
    .zrem(presenceExpiryKey(workspaceId), connection.id)
    .exec();
  await broadcastPresence(workspaceId);
}

async function broadcastPresence(workspaceId: string) {
  const values = await redisClient().hvals(presenceHashKey(workspaceId));
  const members = values
    .flatMap((value) => {
      try {
        return [JSON.parse(value) as CollaborationPresenceEntry];
      } catch {
        return [];
      }
    })
    .slice(0, 100);
  broadcastLocal(workspaceId, { type: "presence", members });
}

async function handleMessage(
  workspaceId: string,
  connection: Connection,
  data: RawData,
  isBinary: boolean,
) {
  const byteLength = Array.isArray(data)
    ? data.reduce((total, part) => total + part.byteLength, 0)
    : data.byteLength;
  if (isBinary || byteLength > MAX_SOCKET_PAYLOAD_BYTES) {
    sendError(
      connection,
      "payload_too_large",
      "Collaboration messages must be JSON under 128 KiB.",
      false,
    );
    return;
  }

  let message;
  try {
    message = collaborationClientMessageSchema.parse(
      JSON.parse(
        Array.isArray(data) ? Buffer.concat(data).toString() : data.toString(),
      ),
    );
  } catch {
    sendError(
      connection,
      "invalid_message",
      "Invalid collaboration message.",
      false,
    );
    return;
  }

  try {
    if (message.type === "join") {
      const worktreeId = await resolveWorktree(workspaceId, message.worktreeId);
      if (!worktreeId) {
        sendError(connection, "not_found", "Active worktree not found.", false);
        return;
      }
      connection.joined = true;
      connection.worktreeId = worktreeId;
      const room = await startRoom(workspaceId);
      const latest = await redisClient().xrevrange(
        streamKey(workspaceId),
        "+",
        "-",
        "COUNT",
        1,
      );
      send(connection, {
        type: "welcome",
        connectionId: connection.id,
        user: connection.user,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        streamId: latest[0]?.[0] ?? room.cursor,
      });
      connection.resumeFrom = message.resumeFrom ?? null;
      await refreshPresence(workspaceId, connection);
      await appendPresenceEvent({
        workspaceId,
        type: "presence.joined",
        data: {
          userId: connection.user.id,
          worktreeId,
          activePath: connection.activePath,
          cursor: connection.cursor,
        },
      });
      return;
    }
    if (!connection.joined) {
      sendError(connection, "not_joined", "Join the workspace first.", false);
      return;
    }
    if (message.type === "subscribe") {
      await subscribe(
        workspaceId,
        connection,
        message.path,
        message.stateVector,
      );
    } else if (message.type === "update") {
      if (!connection.canEdit) {
        sendError(
          connection,
          "forbidden",
          "Edit permission is required to change workspace files.",
          false,
          message.path,
        );
        return;
      }
      await applyDocumentUpdate(
        workspaceId,
        connection,
        message.path,
        message.update,
      );
    } else if (message.type === "awareness") {
      await publishAwareness(
        workspaceId,
        connection,
        message.path,
        message.update,
      );
    } else {
      connection.alive = true;
      await refreshPresence(workspaceId, connection);
    }
  } catch {
    sendError(
      connection,
      "internal_error",
      "The collaboration service could not complete the operation.",
      true,
      "path" in message ? message.path : undefined,
    );
  }
}

export async function handleCollaborationSocket(
  workspaceId: string,
  socket: WebSocket,
  user: CollaborationUser,
  options: { canEdit: boolean },
) {
  const room = await startRoom(workspaceId);
  const connection: Connection = {
    id: randomUUID(),
    socket,
    user,
    joined: false,
    worktreeId: null,
    subscriptions: new Set(),
    activePath: null,
    cursor: null,
    resumeFrom: null,
    replayedPaths: new Set(),
    alive: true,
    canEdit: options.canEdit,
  };
  room.connections.add(connection);

  const heartbeat = setInterval(() => {
    if (!connection.alive) {
      socket.terminate();
      return;
    }
    connection.alive = false;
    socket.ping();
    void refreshPresence(workspaceId, connection);
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  socket.on("pong", () => {
    connection.alive = true;
  });
  socket.on("message", (data, isBinary) => {
    void handleMessage(workspaceId, connection, data, isBinary);
  });
  socket.once("close", () => {
    clearInterval(heartbeat);
    room.connections.delete(connection);
    if (connection.joined) {
      void appendPresenceEvent({
        workspaceId,
        type: "presence.left",
        data: {
          userId: connection.user.id,
          worktreeId: connection.worktreeId,
          activePath: connection.activePath,
          cursor: connection.cursor,
          reason: "disconnect",
        },
      }).catch(() => undefined);
    }
    void removePresence(workspaceId, connection);
    if (room.connections.size === 0) {
      room.polling = false;
      void room.reader.quit();
      localRooms.delete(workspaceId);
    }
  });
  socket.once("error", () => {
    connection.alive = false;
  });
}

export const collaborationSocketMaxPayload = MAX_SOCKET_PAYLOAD_BYTES;

export class CollaborationConflictResolutionError extends Error {
  readonly status = 409;
}

export async function resolveCollaborationConflict(
  workspaceId: string,
  userId: string,
  rawInput: unknown,
) {
  const input: ConflictResolutionInput =
    conflictResolutionInputSchema.parse(rawInput);
  const worktreeId = await resolveWorktree(workspaceId, input.worktreeId);
  if (!worktreeId) throw new Error("Active worktree not found.");

  const result = await withDocumentLock(
    workspaceId,
    worktreeId,
    input.path,
    async () => {
      const snapshot = await loadSnapshot(worktreeId, input.path);
      if (!snapshot?.hasConflict) {
        throw new CollaborationConflictResolutionError(
          "No persistent collaboration conflict exists for this document.",
        );
      }
      if (snapshot.revision !== input.expectedSnapshotRevision) {
        throw new CollaborationConflictResolutionError(
          "The collaboration snapshot changed before resolution.",
        );
      }
      const sandboxWorktreeId = await sandboxWorktreeScope(worktreeId);
      const file = await readSandboxFile(
        workspaceId,
        input.path,
        sandboxWorktreeId,
      );
      if (file.revision !== input.expectedFilesystemRevision) {
        throw new CollaborationConflictResolutionError(
          "The filesystem changed before resolution.",
        );
      }

      const doc = docFromUpdate(snapshot.update);
      let contents = doc.getText("content").toString();
      if (input.strategy === "filesystem") {
        contents = file.contents;
        replaceDocumentContents(doc, contents);
      } else if (input.strategy === "merged") {
        contents = input.mergedContents ?? "";
        replaceDocumentContents(doc, contents);
      }
      let resultRevision = file.revision;
      if (input.strategy !== "filesystem") {
        const written = await writeSandboxFile(workspaceId, {
          path: input.path,
          contents,
          expectedRevision: file.revision,
          ...(sandboxWorktreeId ? { worktreeId: sandboxWorktreeId } : {}),
        });
        resultRevision = written.revision;
      }
      const encoded = encodedDocument(doc);
      const now = new Date();
      await getDatabase().transaction(async (transaction) => {
        const [resolved] = await transaction
          .update(schema.yjsSnapshots)
          .set({
            revision: resultRevision,
            update: encoded.update,
            stateVector: encoded.stateVector,
            filesystemContents: contents,
            filesystemRevision: resultRevision,
            lastSyncedAt: now,
            hasConflict: false,
            conflictFilesystemRevision: null,
            conflictResolvedAt: now,
            conflictResolvedBy: userId,
            conflictResolution: input.strategy,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.yjsSnapshots.worktreeId, worktreeId),
              eq(schema.yjsSnapshots.path, input.path),
              eq(schema.yjsSnapshots.hasConflict, true),
              eq(schema.yjsSnapshots.revision, input.expectedSnapshotRevision),
            ),
          )
          .returning({ id: schema.yjsSnapshots.id });
        if (!resolved) {
          throw new CollaborationConflictResolutionError(
            "The conflict was resolved by another request.",
          );
        }
        await transaction
          .insert(schema.collaborationConflictResolutions)
          .values({
            worktreeId,
            path: input.path,
            resolvedBy: userId,
            strategy: input.strategy,
            snapshotRevision: input.expectedSnapshotRevision,
            filesystemRevision: input.expectedFilesystemRevision,
            resultRevision,
          });
      });
      return {
        revision: resultRevision,
        strategy: input.strategy,
        update: encoded.update,
      };
    },
  );
  await publish(workspaceId, {
    type: "reconciled",
    worktreeId,
    path: input.path,
    revision: result.revision,
    source: result.strategy === "filesystem" ? "filesystem" : "collaboration",
    update: result.update,
  });
  return { revision: result.revision, strategy: result.strategy };
}

export async function checkRealtimeConnection() {
  const client = redisClient();
  if (client.status === "wait") await client.connect();
  const response = await client.ping();
  if (response !== "PONG") {
    throw new Error("The realtime data service did not respond.");
  }
}
