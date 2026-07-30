# CoDev Security Boundary

CoDev separates the Vercel control plane from untrusted Firecracker guests.

## Credentials

- GitHub user tokens and OpenAI keys are encrypted in PostgreSQL and decrypted
  only inside server-side Vercel functions.
- GitHub publication uses the GitHub Git Database API from Vercel. Tokens never
  enter an API body sent to AWS, a microVM environment, a terminal, a clone URL,
  or a Git credential helper.
- AWS access uses short-lived Vercel OIDC credentials. Long-lived AWS access
  keys are prohibited.
- Logs redact authorization, cookies, tokens, encrypted values, prompts, file
  contents, diffs, and terminal output.

## Publication

- Only workspace members with merge capability can publish.
- Publication branches must use the `codev/` namespace.
- Existing remote refs are never updated or force-pushed.
- The installation, repository ID, and repository name are revalidated
  immediately before GitHub mutation.
- The guest exports a clean, exact integration tree guarded by its expected
  SHA. Submodules, unsafe paths, unsupported modes, more than 500 files, files
  over 1 MiB, and trees over 5 MiB are rejected.
- Every attempt has durable `pending`, `published`, or `failed` state and a
  workspace audit event.

## Lifecycle

- A sandbox cannot be stopped while agent worktrees are active.
- A changed integration tree cannot be stopped until its exact source SHA has
  been published. After destruction, CoDev advances the durable baseline to the
  remote publication commit so reprovisioning is recoverable.
- Lifecycle cleanup is authenticated with `CRON_SECRET`, idempotently
  interrupts turns, releases claims, discards physical agent worktrees, and
  treats an already-missing sandbox as success.
- Quotas bound active workspaces, queued turns, daily turns, terminal sessions,
  publication size, and control-plane request rates.

## Dependency Policy

- Production dependencies are pinned and the lockfile is checked against pnpm's
  supply-chain policy before installation.
- The AWS SDK, Smithy signing stack, Sharp, and PostCSS are pinned to patched
  releases.
- The remaining `brace-expansion` advisory is reachable only through the
  Workflow DevKit build CLI and is not bundled into, imported by, or invoked
  from a Vercel request handler. Replacing it across incompatible major
  versions breaks the official Workflow compiler, so it is tracked as a
  build-time upstream exception until Workflow DevKit updates its CLI graph.

## Reporting

Treat unexpected publication refs, secret-shaped log content, cross-workspace
access, or a runtime that remains active after cleanup as a security incident.
Follow [OPERATIONS.md](./OPERATIONS.md), preserve request IDs and timestamps,
revoke affected credentials, and stop the Firecracker host if isolation is in
doubt.
