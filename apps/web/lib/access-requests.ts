import "server-only";

import { desc, eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { sendAccessRequestInvite } from "./access-request-mail";
import { createInviteToken, hashInviteToken } from "./crypto";
import { getDatabase } from "./database";

/** How long an invitation's accept link stays valid. */
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function appBaseUrl(): string {
  const raw = process.env.AUTH_URL || "https://www.trycodev.com";
  return raw.replace(/\/+$/, "");
}

export type AccessRequestRow = {
  id: string;
  email: string;
  name: string;
  persona: string | null;
  building: string | null;
  referrer: string | null;
  status: "pending" | "invited" | "declined" | "accepted";
  createdAt: string;
  invitedAt: string | null;
  acceptedAt: string | null;
  inviteExpired: boolean;
};

export async function listAccessRequests(): Promise<AccessRequestRow[]> {
  const rows = await getDatabase()
    .select({
      id: schema.accessRequests.id,
      email: schema.accessRequests.email,
      name: schema.accessRequests.name,
      persona: schema.accessRequests.persona,
      building: schema.accessRequests.building,
      referrer: schema.accessRequests.referrer,
      status: schema.accessRequests.status,
      createdAt: schema.accessRequests.createdAt,
      invitedAt: schema.accessRequests.invitedAt,
      acceptedAt: schema.accessRequests.acceptedAt,
      inviteTokenExpiresAt: schema.accessRequests.inviteTokenExpiresAt,
    })
    .from(schema.accessRequests)
    .orderBy(desc(schema.accessRequests.createdAt));

  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    persona: row.persona,
    building: row.building,
    referrer: row.referrer,
    status: row.acceptedAt ? "accepted" : row.status,
    createdAt: row.createdAt.toISOString(),
    invitedAt: row.invitedAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    inviteExpired:
      !row.acceptedAt &&
      row.status === "invited" &&
      row.inviteTokenExpiresAt !== null &&
      row.inviteTokenExpiresAt.getTime() <= now,
  }));
}

export type IssueInviteResult = {
  email: string;
  emailSent: boolean;
};

export type WaitlistActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Moves a waitlist row to `invited`, mints a fresh single-use token, and emails
 * the accept link. Safe to call again to re-send: it rotates the token and
 * pushes out the expiry. A row that has already been accepted is left alone.
 */
export async function issueAccessRequestInvite(
  id: string,
): Promise<IssueInviteResult> {
  const db = getDatabase();
  const [existing] = await db
    .select({
      id: schema.accessRequests.id,
      email: schema.accessRequests.email,
      name: schema.accessRequests.name,
      acceptedAt: schema.accessRequests.acceptedAt,
    })
    .from(schema.accessRequests)
    .where(eq(schema.accessRequests.id, id))
    .limit(1);

  if (!existing) throw new Error("That access request no longer exists.");
  if (existing.acceptedAt) {
    throw new Error("That person has already created their account.");
  }

  const token = createInviteToken();
  const now = new Date();
  await db
    .update(schema.accessRequests)
    .set({
      status: "invited",
      invitedAt: now,
      inviteTokenHash: hashInviteToken(token),
      inviteTokenExpiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      updatedAt: now,
    })
    .where(eq(schema.accessRequests.id, id));

  const acceptUrl = `${appBaseUrl()}/invite/accept?token=${token}`;

  let emailSent = true;
  try {
    await sendAccessRequestInvite({
      email: existing.email,
      name: existing.name,
      acceptUrl,
    });
  } catch (error) {
    console.error("Invite email failed to send", error);
    emailSent = false;
  }

  return { email: existing.email, emailSent };
}

export async function declineAccessRequest(id: string): Promise<void> {
  const now = new Date();
  await getDatabase()
    .update(schema.accessRequests)
    .set({
      status: "declined",
      inviteTokenHash: null,
      inviteTokenExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(schema.accessRequests.id, id));
}
