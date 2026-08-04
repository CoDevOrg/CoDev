# Subscription OAuth setup

CoDev keeps Claude Code and Codex OAuth tokens encrypted in the provider
credential store. The application owns the PKCE state and callback flow, but
each provider still needs an OAuth client configured for the deployment.

For every environment, register these callback URLs with the corresponding
provider OAuth client:

```text
https://YOUR_CODEV_DOMAIN/api/auth/oauth/claude/callback
https://YOUR_CODEV_DOMAIN/api/auth/oauth/codex/callback
```

Then add the matching variables to Vercel. Client secrets are optional for
public PKCE clients, but must be added when the provider requires a confidential
client:

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

The redirect URI variables are optional when the default deployment origin is
correct. Set them explicitly when the OAuth provider requires an exact URL.
The app will return to Settings with a setup message when a client ID is
missing; it will never expose provider credentials or token-exchange responses
in the browser.
