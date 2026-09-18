/**
 * Hosted Codex subscription launch gate.
 *
 * Environment variables cannot enable this integration. Production enablement
 * is this source constant, while an emergency-only environment switch may
 * disable new connections and credential resolution during an incident.
 */
export const HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED: boolean = true;

export function isHostedCodexSubscriptionEnabled() {
  return (
    HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED &&
    process.env.HOSTED_CODEX_EMERGENCY_DISABLED !== "true"
  );
}
