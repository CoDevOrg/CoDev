# Provider subscription authentication

## Codex

CoDev uses the same terminal-enrollment pattern exposed by hosted coding-agent
products such as Replicas. CoDev does not implement OpenAI OAuth and does not
need an OpenAI API key, OAuth client secret, JWKS URL, or private Codex bearer
API endpoint.

```sh
npm install -g @trycodev/cli
codev login
codev codex-auth             # personal connection
codev codex-auth --org       # organization connection
```

`codev codex-auth` launches the installed official Codex CLI in an isolated
temporary `CODEX_HOME`. The official CLI performs its own ChatGPT device or
browser login and writes `auth.json` using file credential storage. The CoDev
CLI uploads that complete cache over its authenticated TLS session. It never
prints or logs the cache, and deletes the temporary directory after upload.

The server validates the cache shape and size, encrypts the complete JSON with
the provider-credential KMS context, and stores it as a
`HOSTED_CODEX_SUBSCRIPTION` credential. Only a workspace maintainer may create
an organization-scoped connection.

For a cloud turn, CoDev decrypts the cache just in time, sends it through the
IAM-authenticated Vercel-to-orchestrator channel, and writes it to the guest's
private temporary filesystem with directory mode `0700` and file mode `0600`.
The official `codex exec` process receives the temporary directory as
`CODEX_HOME`, runs with `workspace-write` sandboxing, and the directory is
removed when the process exits. If Codex refreshes the cache, the updated copy
is returned through the private control channel and re-encrypted.
Interactive workspace terminals are closed before the cache is materialized,
and the guest mutation lock prevents a new terminal from starting until cleanup
has completed.

The Firecracker base image installs a pinned official `@openai/codex` release.
Provider material is never included in the base image, workspace volume,
repository, snapshot, browser response, normal terminal environment, command
arguments, or logs.

OpenAI documents both device-code login for headless systems and copying
`~/.codex/auth.json` to a remote/headless machine. Treat that file like a
password. See the [official Codex authentication documentation](https://developers.openai.com/codex/auth).

## CoDev CLI login

`codev login` uses a separate ten-minute, single-use device authorization:

1. The CLI requests a random device secret and human-readable code.
2. The signed-in user explicitly approves that code at `/cli/authorize`.
3. The polling CLI exchanges it once for a random 90-day CoDev CLI token.
4. Only the token hash is stored server-side. The local file is mode `0600`.

`HOSTED_CODEX_EMERGENCY_DISABLED=true` remains an emergency kill switch for
new resolution. Disconnect deletes the encrypted auth cache immediately.
