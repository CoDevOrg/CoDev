# F6.4 — OpenAI Codex connection design

Status: **approved CLI remote-auth implementation.**

CoDev does not operate an OpenAI OAuth client. The user authenticates with the
official Codex CLI, and CoDev securely moves that official auth cache to the
headless Firecracker runner for one `codex exec` process.

The user flow is:

```sh
npm install -g @trycodev/cli
codev login
codev codex-auth
```

Use `codev codex-auth --org` for an organization connection. The CoDev CLI
invokes `codex login --device-auth` with file credential storage and an
isolated temporary `CODEX_HOME`; it does not reproduce OpenAI's OAuth exchange.

OpenAI officially documents device authentication on headless machines and
copying `~/.codex/auth.json` to a remote machine, with the warning to treat the
file like a password. See
[Codex authentication](https://developers.openai.com/codex/auth).

The detailed storage, execution, and cleanup boundary is documented in
[openai-codex-hosted-subscription-bridge.md](./openai-codex-hosted-subscription-bridge.md).

The older F6.5 OAuth fixture remains test-only and is unrelated to this
production CLI bridge. No `HOSTED_CODEX_APPROVED_*` values are required.
