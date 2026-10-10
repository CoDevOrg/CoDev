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
- Parallel lifecycle branches need independent deterministic step names, a shared request budget, and all branches settled before saving continuation checkpoints.
- Workspace connection checks must not wake guests or count as activity. Keepalives come from recent member input or running agent work; persisted `ready` state alone does not establish connectivity.
- An ARM health probe failure does not prove its VM has stopped; verify Azure power state before replacing a ready generation.

- In guest systemd units, set agent-profile parent permissions inside the final `ExecStart` wrapper; systemd reapplies `StateDirectoryMode` after `ExecStartPre`. Individual profiles and credential files must remain private.
- ARM guest units must not recursively change permissions on saved workspace disks; they also carry protected Superset metadata.
- Guest RPC changes require a signed ARM runtime release, image promotion, and an update for existing VMs; a web deployment alone does not update guestd or the Superset host bundle.
- Release guest images with the **Release ARM workspace image** workflow (`release-arm-image.yml`): it picks the next free gallery version, runs the staging canary, then promotes and redeploys. Do not dispatch the raw build workflow with a hand-picked version while it may run; gallery versions are immutable.
- Root guest services must never run Git in the shared repository: workspace users can write its config, which can name commands Git runs. Host Git goes through `workspaceGitSpawnOptions` or `createUserSimpleGit`; `codev-guestd` uses the shell account.
- The Cursor CLI always loads hooks from the repository (`.cursor/hooks.json`, `.claude/settings*.json`) and has no switch to stop it; `codev-guestd` refuses Cursor turns while those files exist. Codex and Claude ignore repository hooks under Gen 2's flags; keep it that way.
- Loopback alone does not isolate privileged workspace RPC from terminal processes. ARM VM images require the local caller firewall before guestd starts; generalized VM administrators use sudo for maintenance RPC.

- GitHub resolves repository variables when a workflow run is created. After changing a rollout or image variable such as `ARM_WORKSPACE_IMAGE_VERSION_ID`, start a new run; one already queued deploys the old value.
- Azure web releases must pass origin readiness before Cloudflare traffic switches; keep the ARM workflow bridge on its separate workers.dev URL to avoid proxy loops.
- Worker WebSocket messages need operation-scoped database pools; Redis clients and stream readers belong to the socket request, never the shared isolate.
- Production Postgres is in AWS us-east-1 while the Azure origin is in West US 2, so each query costs about 70 ms. Keep per-keystroke paths to one query; terminal sockets read membership and the guest route together (`lib/gen2/terminal-access.ts`).
- Worker fetches support `redirect: "manual"`, not `"error"`; reject redirect responses explicitly for authenticated runtime requests.
- ARM lifecycle polling must honor Azure `Retry-After` while staying within Cloudflare Workflows' per-invocation subrequest budget.
- ARM workflow checkpoints are persisted and copied into continuations; never return secrets from one. Build secret-bearing request bodies inside the step that sends them.
- Promote ARM images with the `ARM_WORKSPACE_IMAGE_VERSION_ID` repository variable (lowercase resource group), not by rewriting the write-only `ARM_WORKSPACE_RUNTIME_SECRETS` bundle. Set `CODEX_CATALOG_CLIENT_VERSION` to the same image's Codex pin.
- Agent CLI pins update automatically (`update-agent-clis.yml`); a new CoDev flag for a CLI must also pass `agent-cli-compat.test.ts`.
- A CLI's "too old for this model" error must be matched in `lib/gen2/agent-cli-fallback.ts`, so turns fall back with a note instead of showing it.
- Baked ARM starts poll signed guest health instead of waiting for the deployment. Workflow loops must branch on the attempt count, never the clock, so a continuation replays the same step names.
- ARM VMs join their resource group's shared network from `infra/azure/arm-workspace-network.bicep`; deploy it to a group before web releases start VMs there.
- ARM connection setup must retry package installation safely while cloud-init or apt holds the dpkg lock.

- Before starting or deploying the web app, run `pnpm db:check`. A newer migration ledger entry does not prove older tables exist; repair skipped schema with a forward migration instead of editing applied history. Migrations run before the web deploy, so drop a column only after the release that stopped reading it is live.
- For Azure subscription inspection, use the signed-in Azure CLI. If it is not authenticated, sign in with `az login --tenant 0841fce6-e7c1-4ea4-b4f1-a238d465137b`.

- The Azure Node adapter must own workspace WebSocket upgrades; isolate Next.js's automatic upgrade listener on a non-listening `httpServer`.
- CoDev is a hosted web app. `apps/web` runs on Azure Container Apps behind the Cloudflare proxy for `trycodev.com`, and on Vercel for Vercel-hosted endpoints; active Gen 2 workspaces run in Azure ARM guests. The legacy Firecracker host is retired; keep its deployment workflow disabled unless explicitly restoring it.
- In Gen 2, the agent, editor, terminal, and Git use the same guest filesystem.
- Use Node.js 24+ and `pnpm` for this repository.
- Keep production session cookies host-only; runtime subdomains must never receive app credentials. Treat Upstash rate-limit `reason: "timeout"` as a denial even when `success` is true.
- Browser sessions are revocable `user_sessions` rows; the Auth.js jwt callback validates cookie and row in one joined query on every request, so keep it one query. Never accept credential or session changes from `update()` payloads without the signed rotation ticket (`lib/auth/session-token.ts`).
- A server action that re-issues the session cookie (`unstable_update`) must `redirect()` afterwards: Next re-renders in the same request with the old cookie in `headers()`, which Auth.js reads, so the page looks signed out.
- Use the web package’s `dev` script (Webpack, matching production); allow `127.0.0.1` development resources. Initial connection checks must run in background tabs and have a request/body timeout.
- In a `.claude/worktrees/*` checkout, the browser preview tool starts the main checkout's server, whose `.env.local` targets production. Start the worktree's `next dev` yourself against a local database and open it by URL.
- ARM baked boot must verify the saved disk UUID before mounting or starting guest services; deliver identity and tunnel tokens only through protected Azure settings.
- Preserve durable guest disks across stops/restarts; never treat missing saved workspace data as permission to initialize a fresh checkout.
- Superset worktree discovery uses Git’s registered worktrees. Guest agents may create direct-child worktrees under `/workspace`; the bridge must resolve them safely as well as CoDev-managed worktrees under `.git/codev-agent-worktrees/`.

- Viewer/editor workspace invite links are reusable for groups; opening sharing must preserve the active token, role, and expiry.
- GitHub account choices show the authenticated member and organizations only; shared personal repositories belong under the member and must retain their original installation ID for workspace creation.

## Code standards

- Solve the problem in the fewest lines that remain readable. If a function exceeds 50 lines or a file exceeds 300 (excluding tests), split it.
- One exported component or major function per file. Collocate helpers only when they are private to that module.
- No speculative abstractions. Add a pattern (factory, strategy, registry) only when there are two or more concrete consumers today. Remove abstractions that serve a single caller.
- Every new file must belong to an existing directory. If none fits, justify the new directory in the commit message.
- Prefer early returns over nested conditionals. Prefer `map`/`filter` over manual loops. Prefer computed values over mutable state.
- Cookie-authenticated API mutations must validate the exact Origin; viewers must be rejected before file writes, shell access, or agent execution. Revalidate membership before delivering collaboration or terminal data; never cache terminal mutation permissions.
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

Settings and the workspace load Tailwind utilities without its preflight, so browser margins on `p`/headings and the global `button { font: inherit }` beat utility classes; reset margins and set font size on the component's root rather than relying on `text-sm` on a button.

The public landing page (`app/page.tsx`) does not load Tailwind utilities (only `app/product-theme.css` imports them), so shadcn components render unstyled there; style landing previews with the CSS files in `components/landing/`. The CoDev mark is `/brand/codev-mark.svg` in ice blue `#00bde8`; do not recolor it with filters.

For Gen 2 Superset workspace visual direction and tokens, follow [`docs/design/superset-workspace-ui.md`](docs/design/superset-workspace-ui.md). Chat, composer, and tool activity follow section 8.1 of that contract. Files, editor, terminal, and review follow section 8.2. For workspace controls, follow [`docs/design/workspace-controls.md`](docs/design/workspace-controls.md) and reuse `WorkspaceButton` for actions, including portaled dialogs; keep visual variants centralized and call-site styling limited to layout. The workspace shell loads no Tailwind reset and its utility classes lose to unlayered CSS; read the gotchas in section 11 of the Superset contract before styling shadcn parts there.

## Maintain this guidance

Before finishing a task, check whether this file sent you to the wrong place, missed a reusable project convention, or contains a stale claim. When you can verify a durable improvement, update the relevant line in the same change: correct or remove outdated guidance, or add one concise instruction. Keep task notes and unverified guesses out of this file. If nothing needs improving, leave it as is.
