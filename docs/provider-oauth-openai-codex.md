# F6.4 — OpenAI Codex connection design

Status: **research complete — real hosted OAuth is not approved.**

F6.4 defines the boundary for connecting OpenAI to CoDev. It does **not**
enable a real ChatGPT consent flow. The only supported CoDev production
connection today is a personal OpenAI API key. The F6.5 UI callback is a
clearly-labelled fixture that persists test-only encrypted OAuth-shaped tokens;
it must never be represented as a real ChatGPT or Codex authorization.

## What official OpenAI documentation establishes

OpenAI documents two sign-in methods for its own Codex clients:

1. **Sign in with ChatGPT** for subscription access.
2. **Sign in with an API key** for usage-based access.

The documented browser flow returns credentials to the ChatGPT desktop app,
Codex CLI, or Codex IDE extension. For remote or headless Codex CLI use,
OpenAI documents device-code authentication as a beta alternative. These are
first-party Codex client sign-in flows; they are not documentation of a public
OAuth client-registration or hosted web-app callback contract for CoDev.

Official reference: [OpenAI Codex authentication](https://developers.openai.com/codex/auth).

## Decision

Do **not** implement a real CoDev → ChatGPT/Codex OAuth flow based on:

- the Codex CLI's browser, loopback, or device-code behavior;
- a public/default Codex client identifier;
- inferred `auth.openai.com` endpoints, scopes, redirect URIs, or token
  formats; or
- copying or importing a Codex authentication cache.

Those approaches couple a hosted website to a first-party client flow that the
official documentation does not establish as an integration surface. They
would also make the hosted callback, consent, refresh, revocation, and support
contract speculative.

## Current supported CoDev path

| Use case                    | Supported connection                                    | Notes                                                                                                |
| --------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| CoDev-hosted provider turns | Personal OpenAI API key                                 | Stored server-side, encrypted, redacted in UI, and reauthorized before every turn.                   |
| Codex CLI / IDE local work  | User signs in with ChatGPT or provides an API key       | Follow the official Codex client experience; CoDev does not intercept it.                            |
| Enterprise automation       | Codex access token in a trusted, admin-enabled workflow | This is documented for trusted scripts and private CI runners, not a general hosted user connection. |
| CoDev OAuth UI verification | F6.5 fixture callback only                              | Test-only encrypted fixture tokens; it never opens ChatGPT or grants account access.                 |

## Fixture boundary (F6.5)

The Orca Settings **Official OAuth** row may display a fixture callback as long
as all of the following remain true:

- its copy explicitly says it is a CoDev fixture callback;
- it never opens `auth.openai.com`, ChatGPT, or a device-code page;
- it only accepts the documented fixture code and stores no real token;
- the public response returns redacted status only; and
- API-key and OAuth-shaped fixture records retain separate lifecycles.

The fixture is a persistence and redaction test. It is not evidence that
CoDev's hosted site is authorized to perform ChatGPT/Codex OAuth.

## Approval gate for a real hosted integration

Real OAuth may be considered only after OpenAI publishes or directly provides
all of the following for a third-party hosted application:

1. a supported client registration and approved redirect URI model;
2. documented authorization, token, refresh, and revocation behavior;
3. allowed scopes and account/workspace entitlement semantics;
4. production callback, consent, and error-handling requirements; and
5. security review of server-only token storage, rotation, disconnect, and
   audit behavior.

Until then, CoDev must keep the API-key path as the only real OpenAI provider
connection and must not automate or proxy ChatGPT consent.
