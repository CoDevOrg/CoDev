# CoDev Delivery Plan

## Product Direction

CoDev is a hosted, browser-based development workspace. The GitHub repository contains the source code; users access the product through its Vercel-hosted website.

The Next.js website, control APIs, realtime gateway, and durable agent workflows run on Vercel. Firecracker requires KVM, so the sandbox orchestrator and guest daemon run on AWS bare-metal infrastructure and are reached from Vercel using short-lived OIDC credentials.

## Architecture Decisions

- **Website:** Next.js App Router, React, and TypeScript on Vercel.
- **Realtime:** Vercel Fluid Compute WebSockets with reconnect/resubscribe behavior and external durable state.
- **Persistence:** Managed PostgreSQL for product data and Redis for realtime coordination.
- **Sandboxes:** Apple Container for local development; Firecracker microVMs on AWS bare metal for hosted workspaces.
- **Orchestration:** Go host orchestrator and guest daemon.
- **Agents:** OpenAI Responses API behind an `AgentProvider` contract, later executed as durable Vercel workflows.
- **Source control:** GitHub authorization integration for identity, repository access, and branch publication.
- **Local containers:** Apple Container only. Docker and Docker Compose are not used.

## Status

| Phase | Name                              | Status      |
| ----- | --------------------------------- | ----------- |
| 1     | Foundation and Live Website       | Complete    |
| 2     | GitHub Identity and Workspaces    | Not started |
| 3     | Firecracker Runtime               | Not started |
| 4     | Browser IDE and Terminal          | Not started |
| 5     | Realtime Collaboration            | Not started |
| 6     | Parallel Agent Runtime            | Not started |
| 7     | Collision Coordination and Review | Not started |
| 8     | GitHub Publication and Hardening  | Not started |

## Phase 1: Foundation and Live Website

Create the Vercel-hosted website foundation, shared contracts, persistence schema, Go service boundary, accessible IDE shell, tests, and deployment configuration.

### Acceptance Criteria

- The landing page clearly describes CoDev as a hosted browser workspace.
- The fixture workspace exposes file, editor, agent, and terminal regions with explicit disconnected states.
- Shared contracts cover the v1 workspace and agent domain.
- PostgreSQL migrations represent the v1 data model.
- Web and orchestrator health endpoints return stable `status: "ok"` payloads.
- Formatting, linting, type checking, unit tests, browser smoke tests, Go tests, and production builds pass.
- A verified Vercel deployment is reachable.

### Phase 1 Delivery

- Production: [https://codev-xi.vercel.app](https://codev-xi.vercel.app)
- Vercel project: `codev`
- Project root: `apps/web`
- Runtime: Node.js 24 with Fluid Compute enabled
- Database: `codev-db` Supabase resource connected through Vercel Marketplace
- Verified preview promoted to production without rebuilding
- Completed: July 28, 2026

## Phase 2: GitHub Identity and Workspaces

Implement GitHub sign-in and installation discovery, public-repository selection, encrypted per-user OpenAI credentials, workspace creation, invitations, membership, and owner-managed terminal and merge capabilities.

## Phase 3: Firecracker Runtime

Provision jailed Firecracker microVMs on one AWS bare-metal host, clone repositories, expose authenticated file/PTY/Git operations through the Go guest daemon, enforce quotas, and destroy idle workspace disks.

## Phase 4: Browser IDE and Terminal

Connect Monaco and xterm.js to the sandbox, provide file navigation and search, stream authenticated terminals with backpressure, and show Git status and side-by-side diffs.

## Phase 5: Realtime Collaboration

Add Yjs editing, cursors, active-file presence, Redis room coordination, durable snapshots, reconnect/resubscribe behavior, and filesystem reconciliation across integration and agent worktrees.

## Phase 6: Parallel Agent Runtime

Run up to two durable agent sessions in separate Git worktrees. Stream tool calls and output, allow queued follow-ups and interruption, and use the prompt author's encrypted OpenAI credential for each turn.

## Phase 7: Collision Coordination and Review

Add exact GitHub-issue duplicate detection, path claims, structured agent negotiation, revision-checked writes, collaborative conflict resolution, and capability-gated merge or discard.

## Phase 8: GitHub Publication and Hardening

Publish approved integration branches without exposing GitHub tokens to sandboxes. Add observability, lifecycle cleanup, security tests, quotas, recovery behavior, and the complete design-partner demo runbook.

## Deferred Beyond the Demo

- Private repositories
- Browser preview-port forwarding
- Native desktop or mobile applications
- Semantic duplicate-task matching
- Billing and enterprise RBAC/SSO
- Multi-host sandbox scheduling and multi-region failover
