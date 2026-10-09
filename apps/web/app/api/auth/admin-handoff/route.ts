import { AuthError } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { auth, signIn } from "@/auth";
import { createAdminHandoffUrl } from "@/lib/auth/admin-handoff";
import { forwardedRequest } from "@/lib/http/forwarded-request";
import { ADMIN_HOSTNAME, isAdminHostname } from "@/lib/platform/site-hosts";

const ADMIN_SIGN_IN = `https://${ADMIN_HOSTNAME}/sign-in?callbackUrl=%2Fadmin`;

/** The public site mints a handoff ticket; the admin host redeems it. */
export async function GET(request: NextRequest) {
  const url = new URL(forwardedRequest(request).url);
  if (isAdminHostname(url.hostname)) {
    try {
      await signIn("admin-handoff", {
        ticket: url.searchParams.get("ticket") ?? "",
        redirectTo: "/admin",
      });
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
    }
    return NextResponse.redirect(ADMIN_SIGN_IN, 303);
  }
  const session = await auth();
  const target = session?.user?.id
    ? await createAdminHandoffUrl(session.user.id)
    : null;
  return NextResponse.redirect(target ?? ADMIN_SIGN_IN, 303);
}
