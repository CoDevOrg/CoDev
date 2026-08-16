/**
 * Hosted Codex subscription launch gate.
 *
 * Environment variables cannot enable this integration. Production enablement
 * requires flipping HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED in source after
 * written OpenAI and CoDev security sign-off.
 */
export const HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED: boolean = false;

export function isHostedCodexSubscriptionEnabled() {
  return HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED;
}
