# F6.4 — Official OpenAI Codex OAuth design

Status: **F6.5 fixture callback enabled** in the Orca workspace connection UI.
Connect completes through a CoDev mock/fixture callback. Do not automate a real
ChatGPT consent screen.

This is the approved provider-specific design for connecting **OpenAI** through
official Codex/ChatGPT OAuth. Anthropic/Claude OAuth remains out of scope for
this first Orca connection.

## Why OpenAI Codex

F6.1–F6.3 already persist a personal OpenAI API key as `provider = openai`.
Codex/ChatGPT OAuth is OpenAI's official subscription authorization path for
that same provider id. CoDev already stores `OAUTH_TOKEN` credentials
server-side; F6.4 does not start that flow from Orca.

Official references:

- [Codex authentication](https://developers.openai.com/codex/auth)
- Authorize: `https://auth.openai.com/oauth/authorize`
- Token: `https://auth.openai.com/oauth/token`
- Device verification: `https://auth.openai.com/codex/device`
- Public Codex CLI PKCE client id: `app_EMoamEEZ73f0CkXaXp7hrann`

## Official flow (Codex CLI)

Codex CLI `codex login` is OAuth 2.0 Authorization Code with PKCE (S256):

1. Generate a random `state` and PKCE `code_verifier` / `code_challenge`.
2. Open `https://auth.openai.com/oauth/authorize` with `response_type=code`,
   `client_id`, `redirect_uri`, `scope=openid profile email offline_access`,
   `code_challenge`, `code_challenge_method=S256`.
3. Capture the authorization code on a **loopback** callback
   (`http://localhost:1455/auth/callback`).
4. POST the code plus `code_verifier` to `https://auth.openai.com/oauth/token`.
5. Persist `access_token`, `refresh_token`, and `expires_in`. Refresh tokens
   rotate; concurrent reuse of the same refresh token can invalidate the
   session.

Headless CLI uses device code instead of the loopback callback: show a user
code, ask the person to approve it at `https://auth.openai.com/codex/device`,
then poll for an authorization code.

## What CoDev must not copy from the CLI

CoDev is a **hosted website**, not a local CLI. A loopback listener on
`localhost:1455` is not an acceptable product callback. Real ChatGPT consent
must never be driven by Computer Use.

F6.5 therefore implements **app-callback or fixture-callback** OAuth against
CoDev's origin, not the CLI loopback:

```text
https://www.trycodev.com/api/auth/oauth/codex/callback
```

F6.5 implements that fixture path. Orca **Connect with OpenAI** POSTs
`{ provider: "openai", oauth: "fixture" }` to the workspace connections API.
The server persists an encrypted fixture `OAUTH_TOKEN` ending `fx01` and never
opens `auth.openai.com`.

## Planned CoDev mapping (F6.5)

| Step | CoDev behavior |
| --- | --- |
| Start | Authenticated `POST` creates sealed PKCE state (cookie + server). No secret in the browser. |
| Consent | Real provider consent is out of band. Tests and Computer Use use a **mock/fixture callback** that never opens ChatGPT. |
| Exchange | Server-only token POST to `auth.openai.com/oauth/token` (or a fixture token endpoint in tests). |
| Persist | `saveProviderCredential` with `provider=openai`, `credentialType=OAUTH_TOKEN`, encrypted access/refresh tokens, redacted `lastFour`. |
| Use | `resolveAgentCredential` / `assertProviderConnectionForTurn` already accept `OAUTH_TOKEN`. |
| Disconnect | Existing revoke deletes the personal OpenAI credential. |
| Display | Settings shows `Connected · OAuth · supplied by <name> · ending <lastFour>`. Tokens never return to the client. |

Required controls from F6:

- PKCE S256
- `state` validation
- encrypted refresh tokens at rest
- narrow documented scopes
- explicit disconnect
- provider's documented authorize/token URLs

## Unavailable product state (this card)

Orca Settings → General → **Provider connections** includes an Official OAuth
row for OpenAI:

- Status: `Planned · unavailable`
- Control: disabled **Connect with OpenAI**
- Copy: official Codex OAuth is documented and not enabled in this workspace
  yet; use an API key for now
- No authorize redirect, device-code poll, or paste-code consent UI

The dashboard Claude/Codex card in `oauth-connections-card.tsx` is not the
Orca workspace connection UI and is not F6.4 evidence.

## Approval gate for F6.5

F6.5 may enable Connect only after:

1. This document remains the contract.
2. A mock/fixture callback can complete the token persist path without a real
   ChatGPT session.
3. Computer Use never automates provider consent.
