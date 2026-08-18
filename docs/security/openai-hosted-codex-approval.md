# OpenAI hosted Codex approval record

Status: **approved 2026-08-16 for the official Codex CLI remote-auth pattern.**

The approved implementation delegates ChatGPT authentication and token
lifecycle to the official Codex CLI. CoDev stores and transfers the resulting
official auth cache as a secret for headless cloud execution.

No OpenAI OAuth client secret, redirect URI, issuer, JWKS URL, or private API
base URL is required by this design. Required CoDev infrastructure secrets are:

- `CREDENTIAL_KMS_KEY_ID` for encrypted provider material;
- `AUTH_SECRET` for application authentication; and
- the normal AWS identity used for the signed Vercel-to-orchestrator channel.

`HOSTED_CODEX_EMERGENCY_DISABLED=true` disables new credential resolution.
Provider material must never appear in logs, analytics, browser responses,
workspace volumes, snapshots, or support exports.
