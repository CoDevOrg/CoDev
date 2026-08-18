# Hosted Codex CLI bridge

## Decision

Use the official Codex CLI authentication cache for headless cloud execution.
Do not build a second OpenAI OAuth client and do not call an undocumented Codex
bearer endpoint from the CoDev web application.

```mermaid
sequenceDiagram
  participant U as User terminal
  participant C as Official Codex CLI
  participant W as CoDev control plane
  participant R as Firecracker workspace
  participant O as OpenAI

  U->>W: codev login (single-use device authorization)
  U->>C: codev codex-auth invokes codex login --device-auth
  C->>O: Official Codex authentication
  O-->>C: auth.json cache
  U->>W: Authenticated TLS upload
  W->>W: Validate and KMS-encrypt complete cache
  W->>R: Just-in-time cache over IAM-authenticated channel
  R->>O: Official codex exec
  R-->>W: Final response and refreshed cache
  W->>W: Re-encrypt refresh; delete guest temporary copy
```

## Security boundary

- The CoDev CLI never parses, exchanges, refreshes, prints, or logs OpenAI
  tokens. It delegates all provider behavior to the official Codex CLI.
- The temporary local directory and config token are owner-only (`0700` and
  `0600`). Cleanup runs in a `finally` block.
- Uploads require a hashed, expiring CoDev CLI token. Organization uploads also
  require current maintainer authorization.
- The cache is envelope-encrypted in `provider_credentials.encrypted_material`.
- The guest cache exists only for one `codex exec`, under a randomized private
  temporary directory. It is not put in the workspace disk or snapshots.
- Existing guest PTYs are closed before the cache is materialized; the guest
  mutation lock blocks new terminals until the Codex process and cleanup end.
- Codex runs with `--ephemeral`, `--ignore-user-config`, and the
  `workspace-write` sandbox. Provider diagnostics are not echoed as user output.
- Disconnect removes the encrypted cache. The emergency switch stops new
  credential resolution.

## Credential resolution

1. Use the turn author's active personal connection.
2. Otherwise use the workspace's active organization connection when sharing
   is enabled and the author is still a member.
3. Otherwise use an explicitly configured API-key/provider fallback.
4. Fail closed with a reconnect message.

## Operational requirements

- Pin and deliberately update the official `@openai/codex` version in the
  Firecracker image build.
- Never log request bodies on `/api/cli/codex-auth` or the orchestrator exec
  path.
- Alert on repeated failed CLI exchanges and credential decrypt failures.
- Rotate/revoke CoDev CLI access tokens and the credential KMS key on incident.
- Keep the database-backed 16-minute execution lease around every shared auth
  cache so concurrent turns cannot race refresh-token rotation.

The official basis for this design is OpenAI's documented headless device
login and remote `auth.json` copy procedure:
[Codex authentication](https://developers.openai.com/codex/auth).
