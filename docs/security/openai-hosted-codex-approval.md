# OpenAI hosted Codex subscription approval record

Status: **approved 2026-08-16 — launch flag is on.**

This is the private security record required by
[openai-codex-hosted-subscription-bridge.md](../openai-codex-hosted-subscription-bridge.md).
Do not copy client secrets, tokens, or unused redirect URIs into this file.

## Recorded approval

OpenAI hosted Codex subscription connection for CoDev was approved on
2026-08-16. The source launch flag
`HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED` is `true`. Environment variables
still cannot flip that flag.

## Server-only configuration names

Register only the OpenAI-supplied values in the deployment environment. Never
use the Codex public CLI client ID.

- `HOSTED_CODEX_APPROVED_CLIENT_ID`
- `HOSTED_CODEX_APPROVED_CLIENT_SECRET` (if OpenAI issued one)
- `HOSTED_CODEX_APPROVED_AUTHORIZE_URL`
- `HOSTED_CODEX_APPROVED_TOKEN_URL`
- `HOSTED_CODEX_APPROVED_REVOCATION_URL`
- `HOSTED_CODEX_APPROVED_REDIRECT_URI` (HTTPS only; production callback is
  `/api/auth/hosted-codex/callback`)
- `HOSTED_CODEX_APPROVED_ISSUER`
- `HOSTED_CODEX_APPROVED_SCOPE`
- `HOSTED_CODEX_APPROVED_RUNTIME_GRANT_URL`
- `HOSTED_CODEX_KMS_KEY_ID` (dedicated key when available)

Connect stays unavailable until those required values are present. The F6.5
fixture callback remains a labelled test fixture with a separate credential
lifecycle.
