import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "../platform/database";
import { consumeRateLimit } from "../platform/rate-limit";
import { ADMIN_HANDOFF_PATH, ADMIN_HOSTNAME } from "../platform/site-hosts";
import { sessionRevision } from "./session-revision";

const TICKET_TTL_MS = 60_000;

type Ticket = {
  userId: string;
  revision: string;
  expiresAt: number;
  nonce: string;
};

function sign(payload: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for admin handoff.");
  return createHmac("sha256", secret)
    .update(`admin-handoff:${payload}`)
    .digest("base64url");
}

async function loadAdmin(userId: string) {
  const [row] = await getDatabase()
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
      isAdmin: schema.users.isAdmin,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.isAdmin
    ? { ...row, revision: sessionRevision(row.passwordHash) }
    : null;
}

function openTicket(value: string): Ticket | null {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined || value.length > 2048)
    return null;
  const expected = Buffer.from(sign(payload), "base64url");
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
  try {
    const ticket = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<Ticket>;
    return typeof ticket.userId === "string" &&
      typeof ticket.revision === "string" &&
      typeof ticket.nonce === "string" &&
      typeof ticket.expiresAt === "number" &&
      ticket.expiresAt > Date.now()
      ? (ticket as Ticket)
      : null;
  } catch {
    return null;
  }
}

/** Marks a ticket nonce as spent; storage failures reject the ticket. */
async function claimOnce(nonce: string) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token)
    return (await consumeRateLimit(nonce, "admin-handoff", 1, 3600)).allowed;
  try {
    const result = await new Redis({ url, token }).set(
      `codev:admin-handoff:${nonce}`,
      1,
      { nx: true, ex: 120 },
    );
    return result === "OK";
  } catch {
    return false;
  }
}

/** Signs a one-minute admin-host sign-in link for a current administrator. */
export async function createAdminHandoffUrl(userId: string) {
  const admin = await loadAdmin(userId);
  if (!admin) return null;
  const ticket: Ticket = {
    userId: admin.id,
    revision: admin.revision,
    expiresAt: Date.now() + TICKET_TTL_MS,
    nonce: randomBytes(16).toString("hex"),
  };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  const url = new URL(ADMIN_HANDOFF_PATH, `https://${ADMIN_HOSTNAME}`);
  url.searchParams.set("ticket", `${payload}.${sign(payload)}`);
  return url;
}

/**
 * Redeems a ticket once, only while its account is still an administrator
 * with the credentials it was minted under.
 */
export async function redeemAdminHandoffTicket(value: unknown) {
  if (typeof value !== "string") return null;
  const ticket = openTicket(value);
  if (!ticket || !(await claimOnce(ticket.nonce))) return null;
  const admin = await loadAdmin(ticket.userId);
  if (!admin || admin.revision !== ticket.revision) return null;
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    image: admin.avatarUrl,
    credentialRevision: admin.revision,
  };
}
