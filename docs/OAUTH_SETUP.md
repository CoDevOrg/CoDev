# Provider subscription OAuth setup

Status: **approval-gated for hosted subscriptions.**

CoDev must not use a provider's public CLI client ID, device flow, loopback
callback, authentication cache, or inferred endpoints to connect a user's
subscription to a hosted workspace. Those are first-party client mechanisms,
not a general CoDev cloud integration contract.

The only real OpenAI connection currently supported by CoDev is an API-key
connection. The OpenAI provider connection in Orca Settings is a clearly
labelled test fixture and does not open ChatGPT consent or store a real token.

If OpenAI approves a hosted Codex subscription connection, use only the
client registration, redirect URIs, grant type, scopes, credential lifecycle,
and remote-runtime mechanism OpenAI provides. The implementation is in
`apps/web/lib/hosted-codex-subscription.ts` and related modules. It is disabled
until `HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED` is flipped in source after
written sign-off. Environment variables cannot enable it. The complete required
design and approval checklist is in
[openai-codex-hosted-subscription-bridge.md](./openai-codex-hosted-subscription-bridge.md).

The app must never expose provider credentials or token-exchange responses in
the browser.

Orca Settings → General → **Provider connections** can complete OpenAI Codex
OAuth through the CoDev fixture callback documented in
[provider-oauth-openai-codex.md](./provider-oauth-openai-codex.md). That control
never opens ChatGPT consent.
