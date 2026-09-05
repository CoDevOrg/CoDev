# CoDev Repository Guidance

## Product

CoDev is a hosted website deployed on Vercel. Do not describe it as a downloadable desktop application.

## Required Commands

Run from the repository root. Node.js 24+. pnpm only.

- Install: `pnpm install`
- Develop website: `pnpm dev`
- Format check: `pnpm format:check`
- Lint: `pnpm lint`
- Type check: `pnpm typecheck`
- Unit tests: `pnpm test`
- Production build: `pnpm build`
- Browser tests: `pnpm test:e2e`
- Rust checks: `pnpm rust:check`
- Rebuild embedded Orca bundle: `pnpm orca:web`

## Container Policy

Use Apple's open-source [container](https://github.com/apple/container) tool whenever local container execution is needed. Do not add Dockerfiles, Docker Compose configuration, or commands that require Docker.

## Runtime isolation

Firecracker sandboxes and per-workspace Orca IDE sessions do **not** share a filesystem.

- Backend-driven work (agent execution, worktrees, publication exports) uses **sandbox API routes**.
- Anything an interactive IDE session must see (terminals, Git, `codex resume`) uses **`/ide` file and execution routes**.

Preserve the split between the Vercel-hosted web control plane and AWS-hosted Firecracker/Orca infrastructure.

## packages/ide

`packages/ide` is a self-contained Orca fork and is **not** in the root pnpm workspace.

- Do not include it in root recursive pnpm, Prettier, lint, or test commands.
- Use its own tooling when working in that directory.

## Engineering Conventions

- Follow sibling files in the same package. Do not invent a second pattern.
- Keep Next.js pages as Server Components unless browser state or event handlers require a client boundary.
- Validate data crossing service or persistence boundaries (existing Zod/contracts). Do not add unchecked ad hoc types at those boundaries.
- Keep secrets server-only and never use `NEXT_PUBLIC_` for credentials.
- Add or update tests with every behavior change.

## Deploy & CI Cost Hygiene

Every branch push builds a Vercel preview, and every push to `main` builds a
production deployment. Build minutes are the dominant cost on our Vercel bill
and the budget is small, so keep builds proportional to real change.

- **One commit per change.** When a `packages/ide` source change needs the
  embedded IDE bundle rebuilt, run `pnpm orca:web` and include the regenerated
  `apps/web/public/orca/**` output in the _same_ commit. Do not land a separate
  "regenerate the embedded IDE bundle" follow-up commit — it doubles every
  build for one change.
- **Do not push trivial commits to `main`** (comment/typo fixes, doc-only
  tweaks split off from code). Each one costs a full production build.
- **Prefer one push over many small pushes** to the same branch in quick
  succession while iterating.
- Commits that only touch `services/`, `infra/`, `docs/`, `.github/`,
  `packages/ide/` source (without a regenerated bundle), or `packages/theia-extension/`
  are skipped automatically by the Vercel Ignored Build Step
  (`scripts/vercel-ignore-build.sh`). Keep that script's watch list current if
  the web app's workspace dependencies change.

## Production Test Accounts

For authenticated production UI verification, credentials live in a local file
**outside this repository**. Do not commit, copy, log, screenshot, or paste them
into source, tests, or user-visible output unless the owner explicitly asks.

If login is required and no local credentials file is available, ask the owner.
Do not invent accounts.
