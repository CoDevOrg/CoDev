/**
 * Hosted Codex subscription launch gate.
 *
 * Environment variables cannot enable or disable this integration. Production
 * enablement is this source constant, flipped after written OpenAI and CoDev
 * security sign-off.
 */
export const HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED: boolean = true;

export function isHostedCodexSubscriptionEnabled() {
  return HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED;
}
