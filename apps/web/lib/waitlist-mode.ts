/**
 * Waitlist-only signup gate.
 *
 * While this is on, none of the account-creation paths (credentials, Google,
 * GitHub, Clerk) may create a new `users` row — only sign-in for an existing
 * account is allowed. Production enablement is this source constant, flipped
 * to `false` in a reviewed code change at launch, while an emergency-only
 * environment switch may reopen signup during an incident without a
 * redeploy.
 */
export const WAITLIST_MODE_ENABLED: boolean = true;

export function isWaitlistModeEnabled() {
  return WAITLIST_MODE_ENABLED && process.env.WAITLIST_MODE_DISABLED !== "true";
}
