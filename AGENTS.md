# Agent guidance

## Repository map

- `apps/web/app/`: Next.js pages and layouts; `app/api/` contains HTTP routes.
- `apps/web/components/`: UI grouped by feature; `components/ui/` has shared primitives.
- `apps/web/lib/`: feature logic, including `gen2`, `auth`, `providers`, `runtime`, and `http`.
- `packages/`: shared `contracts`, `db`, `shared-types`, and `config` packages.
- `services/orchestrator/`: Rust workspace and agent runtime service.
- `infra/azure/` and `infra/runtime/`: Azure stack and runtime host scripts.
- `vendor/superset/`: vendored Superset source; search it only for related work.
- `docs/README.md`: documentation index with freshness status. Start there for deeper background.
- `docs/WEB_HOSTING.md`: Cloudflare versus Vercel hosting and secret ownership; update it with any hosting, routing, or runtime-secret change.

## Key conventions and gotchas

- Workspace RPC must resolve the provider and current generation on each call; an unavailable ARM route must never fall back to the Firecracker host.
- Workers Free limits external requests per workflow instance, not per step. Use bounded lifecycle continuations; fence child activation and preserve saved-disk identity across handoffs.
- Workspace connection checks must not wake guests or count as activity. Keepalives come from recent member input or running agent work; persisted `ready` state alone does not establish connectivity.

- In guest systemd units, set agent-profile parent permissions inside the final `ExecStart` wrapper; systemd reapplies `StateDirectoryMode` after `ExecStartPre`. Individual profiles and credential files must remain private.
- ARM guest units must not recursively change permissions on saved workspace disks; they also carry protected Superset metadata.
- Loopback alone does not isolate privileged workspace RPC from terminal processes. ARM VM images require the local caller firewall before guestd starts; generalized VM administrators use sudo for maintenance RPC.

- Worker fetches support `redirect: "manual"`, not `"error"`; reject redirect responses explicitly for authenticated runtime requests.
- ARM lifecycle polling must honor Azure `Retry-After` while staying within Cloudflare Workflows' per-invocation subrequest budget.
- ARM connection setup must retry package installation safely while cloud-init or apt holds the dpkg lock.

- Before starting or deploying the web app, run `pnpm db:check`. A newer migration ledger entry does not prove older tables exist; repair skipped schema with a forward migration instead of editing applied history.
- For Azure subscription inspection, use the signed-in Azure CLI. If it is not authenticated, sign in with `az login --tenant 0841fce6-e7c1-4ea4-b4f1-a238d465137b`.

- CoDev is a hosted web app. `apps/web` deploys to Cloudflare Workers for `trycodev.com` and to Vercel for Vercel-hosted endpoints; active Gen 2 workspaces run in Azure ARM guests. The legacy Firecracker host is retired; keep its deployment workflow disabled unless explicitly restoring it.
- In Gen 2, the agent, editor, terminal, and Git use the same guest filesystem.
- Use Node.js 24+ and `pnpm` for this repository.
- Use the web package’s `dev` script (Webpack, matching production); allow `127.0.0.1` development resources. Initial connection checks must run in background tabs and have a request/body timeout.
- Preserve durable guest disks across stops/restarts; never treat missing saved workspace data as permission to initialize a fresh checkout.
- Superset worktree discovery uses Git’s registered worktrees. Guest agents may create direct-child worktrees under `/workspace`; the bridge must resolve them safely as well as CoDev-managed worktrees under `.git/codev-agent-worktrees/`.

- GitHub account choices show the authenticated member and organizations only; shared personal repositories belong under the member and must retain their original installation ID for workspace creation.

## Code standards

- Solve the problem in the fewest lines that remain readable. If a function exceeds 50 lines or a file exceeds 300 (excluding tests), split it.
- One exported component or major function per file. Collocate helpers only when they are private to that module.
- No speculative abstractions. Add a pattern (factory, strategy, registry) only when there are two or more concrete consumers today. Remove abstractions that serve a single caller.
- Every new file must belong to an existing directory. If none fits, justify the new directory in the commit message.
- Prefer early returns over nested conditionals. Prefer `map`/`filter` over manual loops. Prefer computed values over mutable state.
- API route handlers must be thin: validate input → call a `lib/` function → return a response. Business logic lives in `lib/`, never in `app/api/`.
- Shared types and request/response shapes go in `packages/contracts` or `packages/shared-types`. Never duplicate a type definition across packages.
- Each `lib/` subdirectory has a README describing what it owns and what it does not. Check the README before adding files; update it when the boundary shifts.
- Every change must compile (`pnpm typecheck`), pass lint (`pnpm lint`), and pass existing tests (`pnpm test`). Do not merge code that introduces new warnings.
- Keep diffs minimal: touch only the files necessary for the change. Do not reformat, reorganize imports, or refactor code unrelated to the task at hand.

## UI work

For any UI work, use shadcn/ui and the `shadcn` skill. If the skill is unavailable, install it with one of these commands:

- `pnpm dlx skills add shadcn/ui`
- `npx skills add shadcn/ui`
- `yarn dlx skills add shadcn/ui`
- `bun x skills add shadcn/ui`

For Gen 2 Superset workspace visual direction and tokens, follow [`docs/design/superset-workspace-ui.md`](docs/design/superset-workspace-ui.md). Chat, composer, and tool activity follow section 8.1 of that contract. Files, editor, terminal, and review follow section 8.2. For workspace controls, follow [`docs/design/workspace-controls.md`](docs/design/workspace-controls.md) and reuse `WorkspaceButton` for actions, including portaled dialogs; keep visual variants centralized and call-site styling limited to layout.

## Maintain this guidance

Before finishing a task, check whether this file sent you to the wrong place, missed a reusable project convention, or contains a stale claim. When you can verify a durable improvement, update the relevant line in the same change: correct or remove outdated guidance, or add one concise instruction. Keep task notes and unverified guesses out of this file. If nothing needs improving, leave it as is.
