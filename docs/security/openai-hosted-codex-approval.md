# OpenAI hosted Codex subscription approval record

Status: **not approved — launch flag remains off.**

This is the private security record required by
[openai-codex-hosted-subscription-bridge.md](../openai-codex-hosted-subscription-bridge.md).
Do not copy client secrets, tokens, or redirect-URI allowlists that are not
already documented as public configuration names.

## Required contract (to be filled after OpenAI approval)

- Client ID and registered HTTPS redirect URIs
- Authorization, token, refresh, and revocation endpoints
- Allowed scopes and personal vs organization entitlement semantics
- Approved short-lived runtime-grant delivery mechanism
- Production callback, consent copy, and error-handling requirements
- Written security review of server-only storage, rotation, disconnect, and audit

## Current CoDev control

`HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED` in
`apps/web/lib/hosted-codex-subscription-flag.ts` is `false`. Environment
variables cannot enable the hosted connection. The F6.5 fixture callback remains
a labelled test fixture with a separate credential lifecycle.
