import "server-only";

import { createHash, randomInt } from "node:crypto";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { renderSVG } from "uqr";

import { schema } from "@codev/db";

import { decryptSecret, encryptSecret } from "../platform/crypto";
import { getDatabase } from "../platform/database";
import { consumeRateLimit } from "../platform/rate-limit";
import { recordSecurityEvent } from "./security-events";
import { sendSecurityNotice } from "./security-mail";
import { generateTotpSecret, matchTotpStep, totpUri } from "./totp";

const RECOVERY_CODE_COUNT = 10;
// No 0/o, 1/i/l: recovery codes are typed from paper.
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export class TwoFactorError extends Error {
  constructor(
    readonly reason:
      | "already_enabled"
      | "not_enabled"
      | "no_setup"
      | "invalid_code"
      | "rate_limited",
  ) {
    super(reason);
    this.name = "TwoFactorError";
  }
}

const context = (userId: string) => ({ purpose: "totp", userId });

export function normalizeRecoveryCode(code: string) {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hashRecoveryCode(code: string) {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = Array.from(
      { length: 10 },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    ).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

type Transaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]
>[0];

async function replaceRecoveryCodes(transaction: Transaction, userId: string) {
  const codes = newRecoveryCodes();
  await transaction
    .delete(schema.userRecoveryCodes)
    .where(eq(schema.userRecoveryCodes.userId, userId));
  await transaction
    .insert(schema.userRecoveryCodes)
    .values(
      codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
    );
  return codes;
}

export async function getTwoFactorStatus(userId: string) {
  const [row] = await getDatabase()
    .select({
      enabledAt: schema.userTwoFactor.enabledAt,
      remaining: sql<number>`(select count(*)::int from ${schema.userRecoveryCodes} where ${schema.userRecoveryCodes.userId} = ${userId} and ${schema.userRecoveryCodes.usedAt} is null)`,
    })
    .from(schema.users)
    .leftJoin(
      schema.userTwoFactor,
      eq(schema.userTwoFactor.userId, schema.users.id),
    )
    .where(eq(schema.users.id, userId))
    .limit(1);
  return {
    enabled: Boolean(row?.enabledAt),
    enabledAt: row?.enabledAt ?? null,
    recoveryCodesRemaining: row?.enabledAt ? Number(row.remaining) : 0,
  };
}

export async function isTwoFactorEnabled(userId: string) {
  const [row] = await getDatabase()
    .select({ userId: schema.userTwoFactor.userId })
    .from(schema.userTwoFactor)
    .where(
      and(
        eq(schema.userTwoFactor.userId, userId),
        isNotNull(schema.userTwoFactor.enabledAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Stores a fresh pending secret and returns what the authenticator scans. */
export async function startTwoFactorSetup(userId: string, accountName: string) {
  const secret = generateTotpSecret();
  const encryptedSecret = await encryptSecret(secret, context(userId));
  const [row] = await getDatabase()
    .insert(schema.userTwoFactor)
    .values({ userId, encryptedSecret })
    .onConflictDoUpdate({
      target: schema.userTwoFactor.userId,
      set: { encryptedSecret, lastUsedStep: null, updatedAt: new Date() },
      setWhere: isNull(schema.userTwoFactor.enabledAt),
    })
    .returning({ userId: schema.userTwoFactor.userId });
  if (!row) throw new TwoFactorError("already_enabled");
  const uri = totpUri(secret, accountName);
  return { secret, uri, qrSvg: renderSVG(uri, { border: 2 }) };
}

/** Confirms the pending secret with a first code; returns recovery codes once. */
export async function confirmTwoFactorSetup(userId: string, code: string) {
  await assertAttemptAllowed(userId);
  const database = getDatabase();
  const [pending] = await database
    .select({ encryptedSecret: schema.userTwoFactor.encryptedSecret })
    .from(schema.userTwoFactor)
    .where(
      and(
        eq(schema.userTwoFactor.userId, userId),
        isNull(schema.userTwoFactor.enabledAt),
      ),
    )
    .limit(1);
  if (!pending) throw new TwoFactorError("no_setup");
  const secret = await decryptSecret(pending.encryptedSecret, context(userId));
  const step = matchTotpStep(secret, code, null);
  if (step === null) throw new TwoFactorError("invalid_code");
  const codes = await database.transaction(async (transaction) => {
    const [enabled] = await transaction
      .update(schema.userTwoFactor)
      .set({ enabledAt: new Date(), lastUsedStep: step, updatedAt: new Date() })
      .where(
        and(
          eq(schema.userTwoFactor.userId, userId),
          eq(schema.userTwoFactor.encryptedSecret, pending.encryptedSecret),
          isNull(schema.userTwoFactor.enabledAt),
        ),
      )
      .returning({ userId: schema.userTwoFactor.userId });
    if (!enabled) throw new TwoFactorError("no_setup");
    return replaceRecoveryCodes(transaction, userId);
  });
  await recordSecurityEvent(userId, "two_factor_enabled");
  await sendSecurityNotice(userId, "two_factor_enabled");
  return codes;
}

async function assertAttemptAllowed(userId: string) {
  const limit = await consumeRateLimit(userId, "two-factor", 6, 15 * 60);
  if (!limit.allowed) throw new TwoFactorError("rate_limited");
}

async function claimTotpStep(
  userId: string,
  encryptedSecret: string,
  lastUsedStep: number | null,
  code: string,
) {
  const secret = await decryptSecret(encryptedSecret, context(userId));
  const step = matchTotpStep(secret, code, lastUsedStep);
  if (step === null) throw new TwoFactorError("invalid_code");
  const [claimed] = await getDatabase()
    .update(schema.userTwoFactor)
    .set({ lastUsedStep: step, updatedAt: new Date() })
    .where(
      and(
        eq(schema.userTwoFactor.userId, userId),
        or(
          isNull(schema.userTwoFactor.lastUsedStep),
          lt(schema.userTwoFactor.lastUsedStep, step),
        ),
      ),
    )
    .returning({ userId: schema.userTwoFactor.userId });
  if (!claimed) throw new TwoFactorError("invalid_code");
}

async function claimRecoveryCode(userId: string, code: string) {
  const [used] = await getDatabase()
    .update(schema.userRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.userRecoveryCodes.userId, userId),
        eq(schema.userRecoveryCodes.codeHash, hashRecoveryCode(code)),
        isNull(schema.userRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: schema.userRecoveryCodes.id });
  if (!used) throw new TwoFactorError("invalid_code");
  await recordSecurityEvent(userId, "recovery_code_used");
  await sendSecurityNotice(userId, "recovery_code_used");
}

/**
 * Checks an authenticator code or a recovery code. Both are single-use: the
 * accepted TOTP step is recorded with a compare-and-swap, and a recovery
 * code is consumed the same way, so a replay or a race cannot reuse one.
 */
export async function verifySecondFactor(userId: string, code: string) {
  await assertAttemptAllowed(userId);
  const [row] = await getDatabase()
    .select({
      encryptedSecret: schema.userTwoFactor.encryptedSecret,
      lastUsedStep: schema.userTwoFactor.lastUsedStep,
    })
    .from(schema.userTwoFactor)
    .where(
      and(
        eq(schema.userTwoFactor.userId, userId),
        isNotNull(schema.userTwoFactor.enabledAt),
      ),
    )
    .limit(1);
  if (!row) throw new TwoFactorError("not_enabled");
  if (/^\d{6}$/.test(code.replace(/\s/g, ""))) {
    await claimTotpStep(userId, row.encryptedSecret, row.lastUsedStep, code);
    return "totp" as const;
  }
  await claimRecoveryCode(userId, code);
  return "recovery" as const;
}

export async function disableTwoFactor(userId: string, code: string) {
  await verifySecondFactor(userId, code);
  await getDatabase().transaction(async (transaction) => {
    await transaction
      .delete(schema.userRecoveryCodes)
      .where(eq(schema.userRecoveryCodes.userId, userId));
    await transaction
      .delete(schema.userTwoFactor)
      .where(eq(schema.userTwoFactor.userId, userId));
  });
  await recordSecurityEvent(userId, "two_factor_disabled");
  await sendSecurityNotice(userId, "two_factor_disabled");
}

export async function regenerateRecoveryCodes(userId: string, code: string) {
  await verifySecondFactor(userId, code);
  const codes = await getDatabase().transaction((transaction) =>
    replaceRecoveryCodes(transaction, userId),
  );
  await recordSecurityEvent(userId, "recovery_codes_regenerated");
  return codes;
}
