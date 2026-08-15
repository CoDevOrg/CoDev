# Subscription OAuth setup

CoDev keeps Claude Code and Codex OAuth tokens encrypted in the provider
credential store. By default it uses the public Claude Code and Codex CLI
PKCE clients so hosted deployments can connect subscription accounts without
registering a separate OAuth app:

- **Claude Code** uses Anthropic's manual callback page. Connect opens the
  provider sign-in tab; paste the resulting authorization code back into
  Settings.
- **Codex** uses ChatGPT device-code sign-in. Connect shows a one-time code;
  approve it at `https://auth.openai.com/codex/device`. Device code auth must
  be enabled in ChatGPT security settings when your plan requires it.

Optional overrides still support a first-party app-callback client. Register
these callback URLs with that provider OAuth client, then set the matching
redirect URI variables:

```text
https://YOUR_CODEV_DOMAIN/api/auth/oauth/claude/callback
https://YOUR_CODEV_DOMAIN/api/auth/oauth/codex/callback
```

Environment variables (all optional when using the public CLI defaults):

```text
CLAUDE_OAUTH_CLIENT_ID=
CLAUDE_OAUTH_CLIENT_SECRET=
CLAUDE_OAUTH_AUTHORIZE_URL=
CLAUDE_OAUTH_TOKEN_URL=
CLAUDE_OAUTH_REDIRECT_URI=
CLAUDE_OAUTH_SCOPE=

CODEX_OAUTH_CLIENT_ID=
CODEX_OAUTH_CLIENT_SECRET=
CODEX_OAUTH_AUTHORIZE_URL=
CODEX_OAUTH_TOKEN_URL=
CODEX_OAUTH_REDIRECT_URI=
CODEX_OAUTH_SCOPE=
```

Setting `CLAUDE_OAUTH_REDIRECT_URI` or `CODEX_OAUTH_REDIRECT_URI` switches that
provider into app-callback mode (browser returns directly to CoDev). Client
secrets are optional for public PKCE clients, but must be added when the
provider requires a confidential client.

The app never exposes provider credentials or token-exchange responses in the
browser.

Orca Settings → General → **Provider connections** does not start OAuth yet.
OpenAI Codex OAuth is documented in
[provider-oauth-openai-codex.md](./provider-oauth-openai-codex.md) and shown as
**Planned · unavailable** until F6.5 lands a mock/fixture callback.
