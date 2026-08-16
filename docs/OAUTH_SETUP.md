# Provider subscription OAuth setup

Status: **hosted Codex subscription approved; configure the OpenAI-issued client.**

CoDev must not use a provider's public CLI client ID, device flow, loopback
callback, authentication cache, or inferred endpoints to connect a user's
subscription to a hosted workspace. Those are first-party client mechanisms,
not a general CoDev cloud integration contract.

The supported OpenAI connections are a personal API key and, after OpenAI
approval, a hosted Codex subscription connection. The OpenAI provider
connection in Orca Settings remains a clearly labelled test fixture and does
not open ChatGPT consent or store a real token.

The hosted implementation is in `apps/web/lib/hosted-codex-subscription.ts`
and related modules. `HOSTED_CODEX_SUBSCRIPTION_LAUNCH_APPROVED` is on in
source. Environment variables cannot flip that flag. Connect still requires
the OpenAI-issued client, redirect URI, and endpoint values listed in
[security/openai-hosted-codex-approval.md](./security/openai-hosted-codex-approval.md).
The complete design is in
[openai-codex-hosted-subscription-bridge.md](./openai-codex-hosted-subscription-bridge.md).

The app must never expose provider credentials or token-exchange responses in
the browser.

Orca Settings → General → **Provider connections** can complete OpenAI Codex
OAuth through the CoDev fixture callback documented in
[provider-oauth-openai-codex.md](./provider-oauth-openai-codex.md). That control
never opens ChatGPT consent.
