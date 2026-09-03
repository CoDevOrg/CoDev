# CoDev Repository Guidance

## Product

CoDev is a hosted website deployed on Vercel. Do not describe it as a downloadable desktop application.

## Required Commands

- Install: `pnpm install`
- Develop website: `pnpm dev`
- Format check: `pnpm format:check`
- Lint: `pnpm lint`
- Type check: `pnpm typecheck`
- Unit tests: `pnpm test`
- Production build: `pnpm build`
- Browser tests: `pnpm test:e2e`
- Rust checks: `pnpm rust:check`

## Container Policy

Use Apple's open-source [container](https://github.com/apple/container) tool whenever local container execution is needed. Do not add Dockerfiles, Docker Compose configuration, or commands that require Docker.

## Engineering Conventions

- Keep Next.js pages as Server Components unless browser state or event handlers require a client boundary.
- Validate data crossing service or persistence boundaries.
- Keep secrets server-only and never use `NEXT_PUBLIC_` for credentials.
- Preserve the separation between Vercel-hosted control services and AWS-hosted Firecracker infrastructure.
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

For authenticated Production UI verification, use the local-only account
details in
`/Users/yousefmaher/.codex/automations/codev-one-verified-task-per-run/test-accounts.md`.
This file is intentionally outside the repository and must never be committed
or copied into source, tests, screenshots, logs, or user-visible output unless
the owner explicitly requests the credentials.
