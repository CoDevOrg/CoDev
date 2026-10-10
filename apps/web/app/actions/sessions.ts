"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/components/settings/action-state";
import { actionResult } from "@/components/settings/action-state";
import { revokeCliAccessToken } from "@/lib/auth/cli-access-tokens";
import {
  signOutOtherSessions,
  signOutSession,
} from "@/lib/auth/manage-sessions";
import { requireUser } from "@/lib/auth/session";

const SESSIONS_PATH = "/settings/personal/sessions";

export async function signOutSessionAction(
  sessionId: string,
): Promise<ActionState> {
  const user = await requireUser();
  const error = await signOutSession(user, sessionId);
  if (!error) revalidatePath(SESSIONS_PATH);
  return actionResult(error, "Signed out that session.");
}

/**
 * May re-issue this browser's cookie (a pre-tracking session moves onto its
 * own row), so success redirects instead of re-rendering in place; see
 * changePasswordAction.
 */
export async function signOutOtherSessionsAction(): Promise<ActionState> {
  const user = await requireUser();
  const error = await signOutOtherSessions(user);
  if (error) return { status: "error", message: error };
  redirect(`${SESSIONS_PATH}?signed-out=others`);
}

export async function revokeCliTokenAction(
  tokenId: string,
): Promise<ActionState> {
  const user = await requireUser();
  const revoked = await revokeCliAccessToken(user.id, tokenId);
  if (revoked) revalidatePath(SESSIONS_PATH);
  return actionResult(
    revoked ? null : "That login was already revoked.",
    "Revoked. That device must sign in again.",
  );
}
