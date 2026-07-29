# CoDev

CoDev is a hosted, browser-based engineering workspace where people and AI
agents plan, build, and review software side by side. This repository contains
the website source; CoDev is not a downloadable desktop application.

> Phase 5 adds realtime Yjs editing, multiplayer cursors and presence, durable
> Supabase snapshots, and Redis-backed coordination to authenticated Monaco
> workspaces. The public fixture remains a clearly labelled, disconnected demo
> shell.

## Website

- Production: [https://codev-xi.vercel.app](https://codev-xi.vercel.app)
- Local landing page: `http://localhost:3000`
- Fixture workspace: `http://localhost:3000/workspaces/demo`
- Health endpoint: `http://localhost:3000/api/health`
- Database health: `http://localhost:3000/api/health/database`
- Orchestrator health: `http://localhost:3000/api/health/orchestrator`
- Realtime health: `http://localhost:3000/api/health/realtime`
- Signed-in dashboard: `http://localhost:3000/dashboard`

## Repository

```text
apps/web/               Next.js website and Vercel Functions
packages/contracts/     Shared Zod domain and event contracts
packages/config/        Server-only environment validation
packages/db/            Drizzle schema and PostgreSQL migrations
services/orchestrator/  Rust sandbox-service boundary
infra/aws/              AWS Firecracker infrastructure and deployment
```

## Development

Node.js 24+, pnpm 11.5.0, and Rust 1.97 are required.

```bash
pnpm install
pnpm dev
```

Run all project checks:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm rust:check
git diff --check
```

Optional local PostgreSQL uses [Apple Container](https://github.com/apple/container)
with an OCI image:

```bash
./scripts/dev-services.sh
```

Docker and Docker Compose are intentionally not part of this repository.

Production, preview, and development environments are connected to the
`codev-db` Supabase resource through Vercel Marketplace. Pull the development
credentials into the gitignored local environment with:

```bash
vercel env pull apps/web/.env.local --environment=development --yes
```

GitHub sign-in uses a GitHub App with this callback URL:

```text
https://codev-xi.vercel.app/api/auth/callback/github
```

Configure `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and `GITHUB_APP_SLUG` in
Vercel. `AUTH_SECRET` and the 32-byte `CREDENTIAL_ENCRYPTION_KEY` must also be
set in every environment; never commit any of these values.

## Hosted sandbox runtime

Phase 3 runs jailed Firecracker microVMs on an AWS `a1.metal` host in
`us-east-2`. Vercel uses environment-scoped OIDC roles and short-lived
credentials to call an IAM-authorized API Gateway endpoint; no long-lived AWS
access keys are stored in Vercel. The host has no inbound SSH access and is
managed through AWS Systems Manager. It starts when a workspace needs a
sandbox and stops itself after 15 minutes without an active microVM.

See [infra/aws/README.md](./infra/aws/README.md) for the architecture, quotas,
deployment command, diagnostics, and cost-sensitive resources.

See [PRD.md](./PRD.md) for the product specification and [PLAN.md](./PLAN.md)
for the eight-phase delivery roadmap.
