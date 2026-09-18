"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/admin/admin";
import {
  assignOrganizationPlan,
  setOrganizationFeatureOverride,
  setUserFeatureOverride,
} from "@/lib/admin/admin-feature-access";
import {
  parseOrganizationOverride,
  parsePlanAssignment,
  parseUserOverride,
} from "@/lib/admin/admin-feature-access-input";
import {
  declineAccessRequest,
  issueAccessRequestInvite,
  type WaitlistActionResult,
} from "@/lib/admin/access-requests";

export type AdminFeatureActionResult = { ok: boolean; message: string };

function actionError(error: unknown): AdminFeatureActionResult {
  return {
    ok: false,
    message:
      error instanceof Error ? error.message : "Could not save that change.",
  };
}

export async function updateOrganizationPlan(
  formData: FormData,
): Promise<AdminFeatureActionResult> {
  await requireAdmin();
  try {
    const input = parsePlanAssignment(formData);
    await assignOrganizationPlan(input);
    revalidatePath("/admin");
    return { ok: true, message: "Organization plan updated." };
  } catch (error) {
    return actionError(error);
  }
}

export async function updateOrganizationFeatureOverride(
  formData: FormData,
): Promise<AdminFeatureActionResult> {
  const actor = await requireAdmin();
  try {
    const input = parseOrganizationOverride(formData);
    await setOrganizationFeatureOverride({ ...input, actorUserId: actor.id });
    revalidatePath("/admin");
    return { ok: true, message: "Organization feature access updated." };
  } catch (error) {
    return actionError(error);
  }
}

export async function updateUserFeatureOverride(
  formData: FormData,
): Promise<AdminFeatureActionResult> {
  const actor = await requireAdmin();
  try {
    const input = parseUserOverride(formData);
    await setUserFeatureOverride({ ...input, actorUserId: actor.id });
    revalidatePath("/admin");
    return { ok: true, message: "User feature access updated." };
  } catch (error) {
    return actionError(error);
  }
}

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
