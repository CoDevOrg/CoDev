# Providers

This module owns the registry, configuration, and integration of external service providers, most notably AI model providers (Anthropic, Codex, Cursor). It manages model capabilities, user credentials for these providers, and OAuth connections.

**Does not own:** UI implementations for the chat interface or the parsing of the streamed model output.

**Key files:**

- `ai-model.ts`, `provider-capabilities.ts`, `dynamic-models.ts`: Core definitions and dynamic model discovery.
- `registry.ts`, `resolve.ts`: Provider registration and resolution logic.
- `credentials.ts`, `credential-seat.ts`: Managing access credentials for external APIs.

Cursor CLI subscriptions and API keys run in Gen 2 workspaces. Subscription
authentication is written only to the guest turn’s private profile, never the
shared checkout; Cursor does not run in Rooms.

`cursor-launch-secret.ts` accepts the CLI JSON cache and older stored session
tokens. Legacy tokens use the CLI’s explicit auth-token environment path,
inside the same private profile.

Workspace model discovery authenticates with the initiating member’s resolved
connection. Codex uses its ChatGPT account catalog (including visibility and plan
restrictions), Cursor uses its CLI account catalog and selection restrictions,
and Claude uses Anthropic’s models endpoint. API keys use their own account
catalogs. Cache keys include member, provider, and credential fingerprint for one
minute; failures never substitute public or hard-coded model lists. Provider
catalog availability does not guarantee remaining usage quota or inference access.

Cloudflare relays Codex discovery to the existing Vercel production catalog
service because ChatGPT returns 403 to Worker egress. The shared `CRON_SECRET`
authorizes this fixed service; member account tokens stay on Vercel. Cursor and
Claude continue to query their providers directly. See `docs/WEB_HOSTING.md` for
the endpoint and rollout ordering.
