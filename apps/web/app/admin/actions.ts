"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin";
import {
  declineAccessRequest,
  issueAccessRequestInvite,
  type WaitlistActionResult,
} from "@/lib/access-requests";

export async function inviteWaitlistEntry(
  id: string,
): Promise<WaitlistActionResult> {
  await requireAdmin();
  try {
    const { email, emailSent } = await issueAccessRequestInvite(id);
    revalidatePath("/admin");
    return {
      ok: true,
      message: emailSent
        ? `Invitation sent to ${email}.`
        : `Marked ${email} as invited, but the email failed to send — check RESEND_API_KEY.`,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not send that invite.",
    };
  }
}

export async function declineWaitlistEntry(
  id: string,
): Promise<WaitlistActionResult> {
  await requireAdmin();
  try {
    await declineAccessRequest(id);
    revalidatePath("/admin");
    return { ok: true, message: "Marked as declined." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not update that row.",
    };
  }
}
