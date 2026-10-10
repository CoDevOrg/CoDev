"use server";

import { redirect } from "next/navigation";

import type { ActionState } from "@/components/settings/action-state";
import { actionResult } from "@/components/settings/action-state";
import { changePassword } from "@/lib/auth/change-password";
import { emailPasswordLinkToSelf } from "@/lib/auth/password-link";
import { requireUser } from "@/lib/auth/session";

const text = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "");

/**
 * Re-issues this browser's session cookie on success, then redirects. Setting
 * a cookie re-renders the page in the same request, and that render would
 * read the old cookie from the request headers (Auth.js reads headers(),
 * which Next does not update) and look signed out; a redirect renders with
 * the new cookie merged in.
 */
export async function changePasswordAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const error = await changePassword(user, {
    current: text(formData, "current"),
    password: text(formData, "password"),
    confirm: text(formData, "confirm"),
  });
  if (error) return { status: "error", message: error };
  redirect("/settings/personal/security?password=changed");
}

/** Emails the member a link to set (OAuth-only) or reset their password. */
export async function emailPasswordLinkAction(): Promise<ActionState> {
  const user = await requireUser();
  const error = await emailPasswordLinkToSelf(user.id);
  return actionResult(
    error,
    `We sent a link to ${user.email ?? "your email"}. It expires in one hour.`,
  );
}
