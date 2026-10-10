import "server-only";

import { and, desc, eq, lt } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { readRequestContext } from "./request-context";

export type SecurityEventType =
  | "sign_in"
  | "password_changed"
  | "password_reset"
  | "password_link_sent"
  | "two_factor_enabled"
  | "two_factor_disabled"
  | "recovery_codes_regenerated"
  | "recovery_code_used"
  | "session_revoked"
  | "other_sessions_revoked"
  | "cli_token_revoked";

const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Appends to the member's security history. Best effort: a failed write must
 * never undo or block the security action it describes.
 */
export async function recordSecurityEvent(
  userId: string,
  type: SecurityEventType,
) {
  try {
    const context = await readRequestContext();
    const database = getDatabase();
    await database
      .insert(schema.userSecurityEvents)
      .values({ userId, type, ...context });
    // Keep IP history bounded (see docs/LEGAL.md).
    await database
      .delete(schema.userSecurityEvents)
      .where(
        and(
          eq(schema.userSecurityEvents.userId, userId),
          lt(
            schema.userSecurityEvents.createdAt,
            new Date(Date.now() - RETENTION_MS),
          ),
        ),
      );
  } catch (error) {
    console.warn("[security] Could not record a security event.", type, error);
  }
}

export async function listSecurityEvents(userId: string, limit = 20) {
  return getDatabase()
    .select({
      id: schema.userSecurityEvents.id,
      type: schema.userSecurityEvents.type,
      userAgent: schema.userSecurityEvents.userAgent,
      ipAddress: schema.userSecurityEvents.ipAddress,
      createdAt: schema.userSecurityEvents.createdAt,
    })
    .from(schema.userSecurityEvents)
    .where(eq(schema.userSecurityEvents.userId, userId))
    .orderBy(desc(schema.userSecurityEvents.createdAt))
    .limit(limit);
}
