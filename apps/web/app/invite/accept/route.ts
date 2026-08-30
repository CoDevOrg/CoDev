import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { schema } from "@codev/db";

import { hashInviteToken } from "@/lib/crypto";
import { getDatabase } from "@/lib/database";
import { createInviteGrant, INVITE_GRANT_COOKIE } from "@/lib/invite-grant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The target of the invitation email's link. Validates the single-use token,
 * drops a short-lived signed grant cookie, and sends the person to sign-up.
 * The token is not consumed here — it is retired only once an account is
 * actually created (see `consumeInvite`), so a mistaken early click does not
 * burn the invitation.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  const signIn = new URL("/sign-in", url.origin);

  if (!token) {
    signIn.searchParams.set("error", "InviteInvalid");
    return NextResponse.redirect(signIn);
  }

  const [row] = await getDatabase()
    .select({
      id: schema.accessRequests.id,
      email: schema.accessRequests.email,
      status: schema.accessRequests.status,
      acceptedAt: schema.accessRequests.acceptedAt,
      inviteTokenExpiresAt: schema.accessRequests.inviteTokenExpiresAt,
    })
    .from(schema.accessRequests)
    .where(eq(schema.accessRequests.inviteTokenHash, hashInviteToken(token)))
    .limit(1);

  const expired =
    row?.inviteTokenExpiresAt != null &&
    row.inviteTokenExpiresAt.getTime() <= Date.now();

  if (!row || row.status !== "invited" || row.acceptedAt || expired) {
    signIn.searchParams.set(
      "error",
      row?.acceptedAt
        ? "InviteUsed"
        : expired
          ? "InviteExpired"
          : "InviteInvalid",
    );
    return NextResponse.redirect(signIn);
  }

  signIn.searchParams.set("mode", "sign-up");
  signIn.searchParams.set("invite", "ok");
  const response = NextResponse.redirect(signIn);
  response.cookies.set({
    name: INVITE_GRANT_COOKIE,
    value: createInviteGrant({ email: row.email, requestId: row.id }),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });
  return response;
}
