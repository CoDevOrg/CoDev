# CoDev Delivery Plan

## Product Direction

CoDev is a hosted, browser-based development workspace. The GitHub repository contains the source code; users access the product through its Vercel-hosted website.

The Next.js website, control APIs, realtime gateway, and durable agent workflows run on Vercel. Firecracker requires KVM, so the sandbox orchestrator and guest daemon run on AWS bare-metal infrastructure and are reached from Vercel using short-lived OIDC credentials.

## Architecture Decisions

- **Website:** Next.js App Router, React, and TypeScript on Vercel.
- **Realtime:** Vercel Fluid Compute WebSockets with reconnect/resubscribe behavior and external durable state.
- **Persistence:** Managed PostgreSQL for product data and Redis for realtime coordination.
- **Sandboxes:** Apple Container for local development; Firecracker microVMs on AWS bare metal for hosted workspaces.
- **Orchestration:** Rust host orchestrator and guest daemon.
- **Agents:** OpenAI Responses API behind an `AgentProvider` contract, later executed as durable Vercel workflows.
- **Source control:** GitHub authorization integration for identity, repository access, and branch publication.
- **Local containers:** Apple Container only. Docker and Docker Compose are not used.

## Status

| Phase | Name                              | Status      |
| ----- | --------------------------------- | ----------- |
| 1     | Foundation and Live Website       | Complete    |
| 2     | GitHub Identity and Workspaces    | Complete    |
| 3     | Firecracker Runtime               | Complete    |
| 4     | Browser IDE and Terminal          | Complete    |
| 5     | Realtime Collaboration            | Complete    |
| 6     | Parallel Agent Runtime            | Not started |
| 7     | Collision Coordination and Review | Not started |
| 8     | GitHub Publication and Hardening  | Not started |

## Phase 1: Foundation and Live Website

Create the Vercel-hosted website foundation, shared contracts, persistence schema, Rust service boundary, accessible IDE shell, tests, and deployment configuration.

### Acceptance Criteria

- The landing page clearly describes CoDev as a hosted browser workspace.
- The fixture workspace exposes file, editor, agent, and terminal regions with explicit disconnected states.
- Shared contracts cover the v1 workspace and agent domain.
- PostgreSQL migrations represent the v1 data model.
- Web and orchestrator health endpoints return stable `status: "ok"` payloads.
- Formatting, linting, type checking, unit tests, browser smoke tests, Rust checks, and production builds pass.
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

### Acceptance Criteria

- Users authenticate through the CoDev GitHub App and only see repositories from installations available to their GitHub user token.
- Repository selection excludes private and archived repositories and is revalidated server-side before workspace creation.
- Workspace owners can create single-use, 24-hour invitations and independently grant terminal and merge capabilities to members.
- GitHub access and refresh tokens and per-user OpenAI keys use authenticated encryption at rest and are never returned to the browser.
- Supabase product tables have RLS enabled and grant no Data API access to `anon` or `authenticated`.
- Authenticated product routes and mutation APIs reject anonymous access.

### Phase 2 Delivery

- GitHub App: [CoDev Web Workspace](https://github.com/apps/codev-web-workspace)
- Installation scope: `yousef20920/CoDev`
- Repository permission: read-only contents and metadata
- OAuth user tokens: expiring, with encrypted refresh-token support
- Database: 14 migrated tables with RLS and server-only privileges
- Completed: July 28, 2026

## Phase 3: Firecracker Runtime

Provision jailed Firecracker microVMs on one AWS bare-metal host, clone repositories, expose authenticated file/PTY/Git operations through the Rust guest daemon, enforce quotas, and destroy idle workspace disks.

### Acceptance Criteria

- An SSM-managed AWS bare-metal host boots with KVM and runs the pinned Firecracker release.
- Workspace creation boots a jailed ARM64 microVM, clones the selected repository, and reports its exact Git revision.
- Authenticated file reads and writes, Git status, and PTY execution cross the host-to-guest boundary.
- The host enforces a maximum of two concurrent microVMs, per-workspace CPU, memory, and disk limits, a 30-minute idle timeout, and a four-hour hard expiry.
- Vercel exchanges its workload identity for short-lived AWS credentials scoped to the runtime API and permission to wake the exact Firecracker host; no AWS access keys are stored in Vercel.
- The host has no public inbound access, uses encrypted storage, and is administered through AWS Systems Manager.
- Workspace destruction terminates Firecracker and removes its writable disk and runtime directory.
- A stopped host wakes on sandbox creation and powers itself off after 15 minutes with no active microVMs.

### Phase 3 Delivery

- AWS account and region: `014576992564`, `us-east-2`
- Runtime endpoint: [https://y0h0aur7sc.execute-api.us-east-2.amazonaws.com](https://y0h0aur7sc.execute-api.us-east-2.amazonaws.com)
- Compute: one scale-to-zero `a1.metal` host using a 40 GiB CoDev ARM64 generic-kernel image
- Runtime: Firecracker `v1.13.2`, jailed per workspace
- Vercel authentication: environment-scoped production and preview OIDC roles
- Private routing: API Gateway invokes a usage-based VPC Lambda proxy; no always-on load balancer
- Guest capabilities: repository clone, revision-checked files, Git status, and PTY commands
- Limits: two microVMs; 2 vCPU, 2 GiB RAM, and 10 GiB sparse disk per workspace
- Lifecycle verification: a clean host booted a guest, cloned CoDev, served file/Git/PTY requests, and removed the guest on destroy
- Cost optimization: wake on demand, 15-minute idle shutdown, and a 40 GiB gp3 root volume
- Completed: July 29, 2026

## Phase 4: Browser IDE and Terminal

Connect Monaco and xterm.js to the sandbox, provide file navigation and search, stream authenticated terminals with backpressure, and show Git status and side-by-side diffs.

### Acceptance Criteria

- Authenticated workspace members can open a desktop-first Monaco IDE backed by their running Firecracker workspace.
- File navigation, repository search, revision-checked saves, Git status, and side-by-side diffs use authenticated workspace APIs.
- xterm.js connects to a persistent Rust-managed PTY with resize, reconnect-safe sequencing, acknowledgement, bounded buffering, and backpressure.
- Terminal access remains capability-gated and every sandbox operation is scoped to a workspace membership.
- Browser smoke tests, production health checks, TypeScript checks, and Rust formatting, linting, and tests pass.

### Phase 4 Delivery

- IDE: Monaco editor and diff editor with file explorer, repository search, save conflict protection, and Git status
- Terminal: xterm.js connected to a persistent Rust PTY through authenticated, sequenced long polling
- Runtime: bounded unacknowledged output pauses the guest reader to provide backpressure
- Production: [https://codev-xi.vercel.app](https://codev-xi.vercel.app)
- Completed: July 29, 2026

## Phase 5: Realtime Collaboration

Add Yjs editing, cursors, active-file presence, Redis room coordination, durable snapshots, reconnect/resubscribe behavior, and filesystem reconciliation across integration and agent worktrees.

### Acceptance Criteria

- Authenticated workspace members share Yjs-backed Monaco documents, cursors, and active-file presence without trusting client-supplied identity.
- Vercel WebSocket instances coordinate document events and expiring presence through Redis streams.
- Reconnects resubscribe with Yjs state vectors and recover edits made while the connection was unavailable.
- PostgreSQL stores durable Yjs updates, state vectors, filesystem revisions, and explicit conflict metadata.
- Clean external filesystem changes are ingested into the collaborative document; concurrent collaborative and filesystem changes surface a conflict without overwriting either version.
- Realtime health, contract, reconciliation, formatting, linting, type checking, unit, browser, build, and Rust checks pass.

### Phase 5 Delivery

- Collaboration: Yjs and y-monaco with authenticated WebSocket upgrades, reconnect/resubscribe, and multiplayer awareness
- Coordination: `codev-realtime` Upstash Redis resource connected through the Vercel Marketplace
- Persistence: Supabase-backed durable snapshots with migration `0004_dear_daimon_hellstrom.sql`
- Reconciliation: revision-checked sandbox writes, external-change ingestion, and explicit concurrent-change conflicts
- Health: `/api/health/realtime`
- Production: [https://codev-xi.vercel.app](https://codev-xi.vercel.app)
- Completed: July 29, 2026

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
