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

## Production Test Accounts

For authenticated Production UI verification, use the local-only account
details in
`/Users/yousefmaher/.codex/automations/codev-one-verified-task-per-run/test-accounts.md`.
This file is intentionally outside the repository and must never be committed
or copied into source, tests, screenshots, logs, or user-visible output unless
the owner explicitly requests the credentials.
