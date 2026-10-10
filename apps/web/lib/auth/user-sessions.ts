import "server-only";

import { createHash } from "node:crypto";
import { after } from "next/server";
import { and, desc, eq, gt, isNull, lt, ne, or } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { readRequestContext } from "./request-context";
import { recordSecurityEvent } from "./security-events";

// Auth.js's default JWT lifetime; an idle session is dead after this anyway.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

type Database = ReturnType<typeof getDatabase>;

/**
 * Cookies issued before session tracking carry no session id. They all map
 * to one deterministic row per member, which exists only once revoked, so
 * "sign out other sessions" reaches them without signing anyone out at
 * deploy time.
 */
export function legacySessionId(userId: string) {
  const hex = createHash("sha256")
    .update(`codev-legacy-session:${userId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function createUserSession(
  userId: string,
  signInMethod: string,
  recordSignIn = true,
) {
  const database = getDatabase();
  const context = await readRequestContext();
  const [row] = await database
    .insert(schema.userSessions)
    .values({ userId, signInMethod, ...context })
    .returning({ id: schema.userSessions.id });
  if (!row) throw new Error("Could not start a session.");
  const stale = new Date(Date.now() - SESSION_MAX_AGE_MS);
  await database
    .delete(schema.userSessions)
    .where(
      and(
        eq(schema.userSessions.userId, userId),
        ne(schema.userSessions.id, legacySessionId(userId)),
        or(
          lt(schema.userSessions.lastSeenAt, stale),
          lt(schema.userSessions.revokedAt, stale),
        ),
      ),
    );
  if (recordSignIn) await recordSecurityEvent(userId, "sign_in");
  return row.id;
}

/**
 * The credential hash and this session's row, in one round trip: every
 * authenticated request runs it, and the database is ~70 ms away.
 */
export async function readSessionState(
  userId: string,
  sessionId: string | undefined,
  database: Database = getDatabase(),
) {
  const id = sessionId ?? legacySessionId(userId);
  const [row] = await database
    .select({
      passwordHash: schema.users.passwordHash,
      sessionId: schema.userSessions.id,
      revokedAt: schema.userSessions.revokedAt,
      lastSeenAt: schema.userSessions.lastSeenAt,
    })
    .from(schema.users)
    .leftJoin(
      schema.userSessions,
      and(
        eq(schema.userSessions.id, id),
        eq(schema.userSessions.userId, schema.users.id),
      ),
    )
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!row) return null;
  // A tracked session needs its row; a legacy one is fine until revoked.
  const usable = sessionId
    ? Boolean(row.sessionId) && !row.revokedAt
    : !row.revokedAt;
  return { passwordHash: row.passwordHash, usable, lastSeenAt: row.lastSeenAt };
}

/** Refreshes "last active" at most every five minutes, off the request path. */
export function touchUserSession(sessionId: string, lastSeenAt: Date | null) {
  if (lastSeenAt && Date.now() - lastSeenAt.getTime() < TOUCH_INTERVAL_MS)
    return;
  const touch = () =>
    getDatabase()
      .update(schema.userSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.userSessions.id, sessionId))
      .then(() => undefined)
      .catch(() => undefined);
  try {
    after(touch);
  } catch {
    void touch();
  }
}

export async function listUserSessions(userId: string) {
  return getDatabase()
    .select({
      id: schema.userSessions.id,
      signInMethod: schema.userSessions.signInMethod,
      userAgent: schema.userSessions.userAgent,
      ipAddress: schema.userSessions.ipAddress,
      createdAt: schema.userSessions.createdAt,
      lastSeenAt: schema.userSessions.lastSeenAt,
    })
    .from(schema.userSessions)
    .where(
      and(
        eq(schema.userSessions.userId, userId),
        isNull(schema.userSessions.revokedAt),
        gt(
          schema.userSessions.lastSeenAt,
          new Date(Date.now() - SESSION_MAX_AGE_MS),
        ),
      ),
    )
    .orderBy(desc(schema.userSessions.lastSeenAt))
    .limit(50);
}

export async function revokeUserSession(userId: string, sessionId: string) {
  const revoked = await getDatabase()
    .update(schema.userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.userSessions.id, sessionId),
        eq(schema.userSessions.userId, userId),
        isNull(schema.userSessions.revokedAt),
      ),
    )
    .returning({ id: schema.userSessions.id });
  return revoked.length > 0;
}

/**
 * Revokes every session except `keepSessionId` (pass null to revoke all),
 * including cookies issued before session tracking.
 */
export async function revokeOtherUserSessions(
  userId: string,
  keepSessionId: string | null,
  database:
    | Database
    | Parameters<Parameters<Database["transaction"]>[0]>[0] = getDatabase(),
) {
  const now = new Date();
  await database
    .update(schema.userSessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.userSessions.userId, userId),
        isNull(schema.userSessions.revokedAt),
        keepSessionId ? ne(schema.userSessions.id, keepSessionId) : undefined,
      ),
    );
  if (keepSessionId === legacySessionId(userId)) return;
  await database
    .insert(schema.userSessions)
    .values({
      id: legacySessionId(userId),
      userId,
      signInMethod: "legacy",
      revokedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.userSessions.id,
      set: { revokedAt: now },
    });
}
