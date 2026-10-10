import "server-only";

import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { recordSecurityEvent } from "./security-events";

/** Live CLI and mobile-app logins, for Settings → Sessions. */
export async function listCliAccessTokens(userId: string) {
  return getDatabase()
    .select({
      id: schema.cliAccessTokens.id,
      name: schema.cliAccessTokens.name,
      clientType: schema.cliAccessTokens.clientType,
      createdAt: schema.cliAccessTokens.createdAt,
      lastUsedAt: schema.cliAccessTokens.lastUsedAt,
      expiresAt: schema.cliAccessTokens.expiresAt,
    })
    .from(schema.cliAccessTokens)
    .where(
      and(
        eq(schema.cliAccessTokens.userId, userId),
        isNull(schema.cliAccessTokens.revokedAt),
        gt(schema.cliAccessTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.cliAccessTokens.createdAt))
    .limit(50);
}

export async function revokeCliAccessToken(userId: string, tokenId: string) {
  const now = new Date();
  const revoked = await getDatabase()
    .update(schema.cliAccessTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.cliAccessTokens.id, tokenId),
        eq(schema.cliAccessTokens.userId, userId),
        isNull(schema.cliAccessTokens.revokedAt),
      ),
    )
    .returning({ id: schema.cliAccessTokens.id });
  if (revoked.length) await recordSecurityEvent(userId, "cli_token_revoked");
  return revoked.length > 0;
}
