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

| Phase | Name                                  | Status      |
| ----- | ------------------------------------- | ----------- |
| 1     | Foundation and Live Website           | Complete    |
| 2     | GitHub Identity and Workspaces        | Complete    |
| 3     | Firecracker Runtime                   | Complete    |
| 4     | Browser IDE and Terminal              | Complete    |
| 5     | Realtime Collaboration                | Complete    |
| 6     | Parallel Agent Runtime                | Complete    |
| 7     | Collision Coordination and Review     | Complete    |
| 8     | GitHub Publication and Hardening      | Complete    |
| 9     | Launch Validation and Design Partners | In progress |
| 10    | Closed Beta Operations and Analytics  | Paused      |

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
- Repository permission: read/write contents, read/write pull requests, and read-only metadata
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

### Acceptance Criteria

- Authenticated workspace members can run at most two agent sessions, each in a detached Git worktree isolated from the integration checkout and the other agent.
- Vercel Workflow DevKit durably drains queued turns and can resume after function restarts or step retries.
- OpenAI Responses API calls use `gpt-5.6-sol`, bounded repository tools, and the prompt author's encrypted key without persisting plaintext credentials in workflow state or exposing them to the browser or sandbox.
- The IDE displays agent status, tool activity, results, queued follow-ups, failures, and interruption controls.
- Agent file and command tools are path-confined, timeout-bounded, and cannot publish, merge, or access host credentials.
- Schema, web, workflow, browser, and Rust checks pass against the deployed database and runtime.

### Phase 6 Delivery

- Agents: two app-level durable sessions with queue-draining Vercel workflows
- Model: OpenAI Responses API using `gpt-5.6-sol` with medium reasoning
- Isolation: detached Git worktrees inside each Firecracker workspace
- Persistence: Supabase-backed turns, workflow run IDs, results, and idempotent activity events
- Controls: queue follow-up and interrupt from the browser IDE
- Security: per-author encrypted BYO key remains server-side; sandboxes receive no provider or GitHub credentials
- Production: [https://codev-xi.vercel.app](https://codev-xi.vercel.app)
- Completed: July 29, 2026

## Phase 7: Collision Coordination and Review

Add exact GitHub-issue duplicate detection, path claims, structured agent negotiation, revision-checked writes, collaborative conflict resolution, and capability-gated merge or discard.

### Acceptance Criteria

- Assigning the same GitHub issue to a second agent in the same repository is rejected before a worktree is created.
- Agents claim exact paths or directory patterns before writing, can contest overlaps, and negotiate through correlated, typed coordination messages.
- Collaborative document events are isolated by worktree; filesystem conflicts preserve both versions until a member explicitly chooses the editor, sandbox, or merged result.
- Review preparation creates a stable checkpoint and complete binary-safe diff digest while freezing further agent turns.
- Rebase reports conflicting paths and aborts cleanly without losing the review checkpoint.
- Members with merge capability can merge only the reviewed head and digest into the current integration head; stale reviews, active conflicts, and contested claims block the operation.
- Merge and discard cancel durable workflows, release claims, and remove agent worktrees idempotently.
- Formatting, linting, type checking, unit tests, browser tests, production builds, Rust checks, database checks, and deployed health checks pass.

### Phase 7 Delivery

- Assignment: optional exact GitHub issue ownership with repository-wide uniqueness
- Coordination: expiring path claims, overlap detection, contests, and structured agent-to-agent negotiation
- Review: immutable checkpoint, complete diff digest, guarded rebase, capability-gated merge, and discard
- Collaboration: explicit editor, filesystem, or merged conflict resolution with revision guards and audit history
- Runtime: Rust release `phase7-1e532399ccbd` on the scale-to-zero AWS host
- Database: Supabase migration `0006_cynical_vin_gonzales.sql` with RLS and server-only privileges
- Production: [https://codev-xi.vercel.app](https://codev-xi.vercel.app)
- Completed: July 29, 2026

## Phase 8: GitHub Publication and Hardening

Publish approved integration branches without exposing GitHub tokens to sandboxes. Add observability, lifecycle cleanup, security tests, quotas, recovery behavior, and the complete design-partner demo runbook.

### Acceptance Criteria

- A member with merge capability can publish the exact clean integration tree to a new immutable `codev/` GitHub branch, while the default branch and existing refs are never updated.
- GitHub tokens remain encrypted at rest and exist only in Vercel server memory; the browser, AWS proxy, Rust orchestrator, guest daemon, terminal, and sandbox disk never receive them.
- Publication revalidates the GitHub installation and repository, rejects unsafe paths and refs, enforces bounded binary-safe export limits, and converges after partial failure without duplicate refs.
- A sandbox with active agent worktrees or unpublished integration changes cannot be stopped. A published workspace restarts from its remote publication commit.
- Scheduled lifecycle reconciliation is authenticated, idempotent, interrupts turns, expires claims, discards physical worktrees, reconciles missing runtimes, expires invitations, and does not wake a sleeping EC2 host.
- Per-user workspace and turn quotas, distributed request limits, terminal caps, payload ceilings, and `429` responses bound abuse and cost.
- Vercel and Rust emit structured, request-correlated, redacted logs; aggregate readiness treats a stopped scale-to-zero host as healthy; AWS retains access/function logs and alarms on API, Lambda, and EC2 failures.
- Anonymous/security browser checks, TypeScript and Rust tests, migration checks, builds, preview verification, and production verification pass.
- Operations, security, rollback, incident, deployment-verification, and design-partner demo runbooks cover the complete publication-to-scale-to-zero journey.

### Phase 8 Delivery

- Publication: immutable `codev/` GitHub branches created through the server-side Git Database API
- Recovery: publication-aware stop guards, durable restart baselines, and authenticated daily lifecycle reconciliation
- Cost controls: workspace and turn quotas, distributed request limits, terminal caps, and scale-to-zero reconciliation
- Observability: request-correlated redacted logs, aggregate readiness, 14-day AWS logs, alarms, and a CloudWatch dashboard
- Runtime: Rust release `phase8-58fc306a2431` with collision-free Firecracker slots and supervised guest cleanup
- Database: Supabase migration `0007_flashy_sphinx.sql` with RLS and server-only privileges
- Security: GitHub App Contents read/write approved for installation `149706596`
- Runbooks: security boundary, operations/rollback, deployment verification, and design-partner demo
- Production: [https://codev-xi.vercel.app](https://codev-xi.vercel.app)
- Completed: July 30, 2026

## Phase 9: Launch Validation and Design Partners

**Goal:** Make the complete CoDev workflow safe and repeatable for early design
partners, including private repositories, structured product feedback, and
visible infrastructure cost controls.

### Acceptance Criteria

- GitHub App installations expose eligible public and private repositories,
  with visibility identified before workspace creation.
- Private repository source reaches AWS as a bounded, credential-free snapshot;
  GitHub credentials never enter the orchestrator, microVM, terminal, logs, or
  clone configuration.
- Private and public workspaces support the same IDE, collaboration, agent,
  review, publication, and lifecycle flows.
- Signed-in users can submit categorized design-partner feedback from CoDev,
  and submissions retain enough product context for follow-up without storing
  prompts, source code, diffs, terminal output, or provider credentials.
- Launch preflight reports website, database, realtime, orchestrator, GitHub,
  runtime, and scale-to-zero state with actionable recovery guidance.
- AWS infrastructure declares a configurable monthly budget alert and keeps
  the Firecracker host stopped when no workspace requires it.
- Automated tests cover repository visibility, private snapshot validation,
  feedback authorization/validation, launch preflight, and anonymous access.
- The complete design-partner runbook is exercised against production without
  moving the repository default branch.

### Phase 9 Delivery

- Launch preflight: authenticated website, database, realtime, orchestrator,
  GitHub, host-state, and scale-to-zero checks with recovery guidance.
- Private repositories: visibility-aware discovery and bounded,
  credential-free GitHub tree snapshots materialized by the Rust orchestrator.
- Feedback: authenticated, rate-limited design-partner submissions with
  category, rating, page, release, and optional workspace context.
- Database: migration `0008_launch_design_partners.sql`; feedback has RLS
  enabled and no `anon` or `authenticated` Data API grants.
- Cost controls: configurable `codev-runtime-monthly` AWS budget, set to
  USD 75, plus the existing wake-on-demand and idle host shutdown behavior.
- Production: [https://codev-xi.vercel.app](https://codev-xi.vercel.app),
  release `be04164fae9b`.
- Automated production verification and a private-repository sandbox smoke
  test passed; the two-identity design-partner session remains to be exercised.
- Started: July 30, 2026

## Phase 10: Closed Beta Operations and Analytics

**Goal:** Give CoDev operators a private control surface for running repeatable
design-partner sessions, recording non-sensitive launch evidence, and measuring
the product outcomes defined in the PRD.

### Acceptance Criteria

- Only explicitly configured GitHub logins can access pilot APIs and the pilot
  console; ordinary authenticated users receive no cross-tenant operational
  data.
- Operators can start a validation session for a workspace, record each
  launch-checklist checkpoint, mark blockers, and complete only a fully
  verified session.
- Pilot evidence stores booleans and operational metadata only—not source code,
  prompts, diffs, terminal output, repository contents, or provider secrets.
- The console reports weekly multi-user workspaces, co-steering rate,
  contested path claims, publication count, feedback count, and returning-user
  rate from durable product events.
- Feedback can be triaged as new, reviewing, planned, or resolved without
  exposing it outside the pilot-admin boundary.
- Pilot tables have RLS enabled and no Supabase Data API grants for `anon` or
  `authenticated`.
- Contracts, authorization tests, migration checks, browser smoke tests, and
  production readiness pass.
- The AWS host returns to scale-to-zero after validation, lifecycle
  reconciliation is idempotent, and the monthly budget remains active.

### Phase 10 Delivery

- **Done locally:** roadmap and acceptance criteria; typed pilot checkpoint,
  session, feedback-status, and environment contracts; GitHub-login allowlist
  helper; pilot session schema and tests.
- **Done locally:** admin-only `/pilot` console, session creation/checkpoint/
  blocker/completion APIs, feedback triage, seven-day product signals,
  conditional Pilot navigation, responsive styling, anonymous-access smoke
  coverage, and the pilot/operations documentation.
- **Done in Supabase:** migration `0010_jittery_praxagora.sql` was applied to
  the connected production database. `pilot_sessions` has RLS enabled,
  `anon`/`authenticated` Data API access revoked, status/checkpoint/blocker
  constraints, and one-active-session-per-workspace enforcement. A direct
  verification returned `rls=true`, both public role checks `false`, six
  constraints, and four indexes.
- **Verified:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
  (47 unit tests), `pnpm build`, `pnpm rust:check` (8 Rust tests), and
  `git diff --check` all pass on the committed source.
- **Verified:** the full Playwright smoke suite passes locally against a
  production build, including the anonymous `POST /api/pilot/sessions` check
  that returns `401`.
- **Done in Vercel:** `PILOT_ADMIN_GITHUB_LOGINS=yousef20920` is configured
  independently in Development, Preview (all preview branches), and Production.
- **Done in Git:** Phase 10 source is committed as `5efe9a5` (`Implement Phase
10 closed beta operations console`) and pushed to `origin/main`.
- **Done in Vercel (preview):** deployment
  `dpl_8eifH3A8MwPGqfLMWb8A6K4o9yJ7`
  (`codev-f1whloqwj-yousef20920s-projects.vercel.app`) built `READY`. Behind the
  automation-bypass header, `/api/health` returned `200 ok`, `/api/ready`
  returned `200 ready` for release `5efe9a5` with database and realtime ready
  and the orchestrator sleeping, the anonymous pilot API returned `401`, and
  `/pilot` returned a `307` redirect to `/sign-in`.
- **Done in Vercel (production):** the Phase 10 application code shipped in
  commit `5efe9a5` and is live on `codev-xi.vercel.app`. Production tracks
  `origin/main` through Vercel's Git integration, so documentation-only commits
  after `5efe9a5` (including this release-state update) redeploy identical
  application behavior. On the production alias `/api/health` returned `200`,
  `/api/ready` returned `200` (database and realtime ready, orchestrator
  sleeping), anonymous `POST /api/pilot/sessions` returned `401`, and `/pilot`
  and `/dashboard` both redirected unauthenticated requests to `/sign-in`.
- **Done in AWS:** the Firecracker host `i-0c4d61ad38518be40`
  (`codev-firecracker-host`, `us-east-2`) was `stopped` at deploy-verification
  time, then woken on demand for the solo pilot sandbox, and afterwards returned
  to `stopped` (scale-to-zero). Note: the graceful `stop-instances` hung in
  `stopping` for ~13 minutes and required a `--force` stop to complete — a
  runtime/host-shutdown issue worth investigating. The app itself never stops
  the host (only `requestHostWake` starts it), so scale-to-zero is an operator
  action, as the launch preflight guidance states.
- **Verified (authenticated browser, production):** signed in as the
  allowlisted operator `yousef20920` and confirmed the `/pilot` console renders
  product signals, workspaces, sessions, and feedback. Exercised every console
  mutation successfully: creating a pilot session, toggling checkpoints on and
  off, feedback triage (new → reviewing → new), and the completion guard
  ("Complete pilot" stays disabled until all ten checkpoints are checked). No
  browser console errors were observed.
- **Partial (solo) two-identity pilot on `yousef20920/Yousefs_resume`:** with
  the user's approval, ran the single-identity-achievable steps live on
  production. Genuinely satisfied and recorded six checkpoints: launch preflight
  passes, authenticated terminal works (sandbox `exec` returned exit 0), a
  `codev/*` branch is published (`codev/pilot-2026-07-30`, commit `20e5ba5`),
  the default branch remains unchanged (publication used a distinct ref off the
  base SHA), design-partner feedback is submitted, and sandbox teardown is
  confirmed. One agent session (`pilot-check`) also completed a turn.
- **Observation:** preparing an agent review returned "Sandbox service returned
  HTTP 403" from the guest microVM, so the agent's change was discarded rather
  than merged and the published branch reflects the integration base. This is a
  runtime-layer (Phase 3–8) issue to investigate separately; it did not affect
  the Phase 10 console.
- **Not done (needs a second GitHub identity):** four checkpoints remain
  unchecked and the pilot session is intentionally left `RUNNING`, not
  completed — "Second GitHub identity joins", "Realtime presence and editing
  work" (meaningful only with two participants), "Two agent sessions complete
  turns" (needs two distinct authors), and "A contested path claim is resolved"
  (needs two actors). Phases 9 and 10 remain open until a two-identity session
  satisfies these and the pilot is completed.
- Started: July 30, 2026
- Paused: July 30, 2026
- Resumed, deployed to production, and ran the solo partial pilot: July 30, 2026

### Phase 10 Resume Handoff

#### Current repository state

- Branch: `main`.
- Last committed source at pause: `0543b47` (`Fix private workspace lifecycle
baseline`).
- **Update (resume):** the Phase 10 worktree has since been committed as
  `5efe9a5` and pushed to `origin/main`; production runs release `5efe9a5` on
  `codev-xi.vercel.app`. Any remaining edits (for example an authenticated-
  verification fix) should be new commits on top of `5efe9a5`; do not reset it.
- The main Phase 10 files are `apps/web/app/pilot/page.tsx`,
  `apps/web/components/pilot-console.tsx`, `apps/web/lib/pilot.ts`,
  `apps/web/lib/pilot-access.ts`, `apps/web/app/api/pilot/**`,
  `packages/contracts/src/domain.ts`, `packages/db/src/schema.ts`,
  `packages/db/drizzle/0010_jittery_praxagora.sql`, and
  `docs/PILOT_OPERATIONS.md`; related tests, configuration, navigation, CSS,
  README, operations docs, and Drizzle metadata are also modified.
- The database migration is already applied even though its source file is not
  committed. On resume, do not manually re-run its SQL. Drizzle migration
  tracking should make `pnpm db:migrate` idempotent, but inspect migration
  status before doing so.
- No development server, watcher, migration, or deployment process was left
  running when work paused.
- No Phase 10 AWS infrastructure change was made. Keep the scale-to-zero host
  stopped unless a deliberate sandbox validation needs it.

#### Important implementation decisions

- Phase 10 is a closed-beta operations layer, not a new end-user workflow.
- Access is a case-insensitive, comma-separated GitHub-login allowlist in the
  server-only `PILOT_ADMIN_GITHUB_LOGINS` variable. The page and every mutation
  API authorize independently.
- Pilot records contain operational booleans and metadata only. Do not add
  source, prompts, model output, diffs, terminal output, repository contents,
  GitHub tokens, OpenAI keys, or encrypted credential values.
- Feedback text is visible to allowlisted operators because users explicitly
  submitted it for review.
- Metrics are computed from existing operational tables and bounded to 10,000
  recent event/turn rows during closed beta. Before broad access, replace this
  with durable aggregates or materialized reporting.
- The Supabase table remains server-only: RLS is defense in depth and no
  `anon` or `authenticated` grants should be added.

#### First actions in the next chat

Steps 1–6 below are complete as of release `5efe9a5` (see Phase 10 Delivery for
evidence). The only remaining work is interactive and needs GitHub sign-in:

1. ~~Run `git status --short` and review the Phase 10 diff without discarding
   it.~~ Done.
2. ~~Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm build`, `pnpm rust:check`, and `git diff --check`; fix failures.~~
   Done — all pass.
3. ~~Run Playwright locally or against a preview, including the new anonymous
   pilot API check.~~ Done — smoke suite passes.
4. ~~Configure `PILOT_ADMIN_GITHUB_LOGINS=yousef20920` independently in Vercel
   development, preview, and production.~~ Done.
5. ~~Commit the exact verified source, push it, deploy a preview, and verify
   `/api/health`, `/api/ready`, authentication, and the anonymous pilot API.~~
   Done — committed `5efe9a5`, preview verified via automation bypass.
6. ~~Promote the verified source to production, repeat smoke checks, confirm the
   AWS host returns to stopped, and update this plan with the release
   SHA/URL.~~ Done — production runs `5efe9a5` on `codev-xi.vercel.app`; host
   `i-0c4d61ad38518be40` is `stopped`.
7. **Remaining:** sign in to production as an allowlisted operator
   (`yousef20920`) and verify the `/pilot` console renders, session
   create/checkpoint/blocker/completion mutations work, feedback triage works,
   and there are no browser console errors (including mobile panel collapse).
8. **Remaining:** run the two-identity design-partner pilot end to end, then and
   only then mark Phases 9 and 10 complete. These require interactive GitHub
   authentication (and a second identity) that could not be performed
   non-interactively during this resume.

#### Tools, connectors, and CLIs

- **Codex file tools:** `apply_patch` was used for source and documentation
  edits; shell commands were used read-only or for project verification. In a
  new chat, open this repository and ask Codex to resume from this handoff.
- **pnpm:** the monorepo task runner. Common commands are `pnpm typecheck`,
  `pnpm test`, `pnpm build`, `pnpm test:e2e`, and `pnpm rust:check`.
- **Drizzle Kit:** schema/migration CLI behind `pnpm db:generate` and
  `pnpm db:migrate`. Migration `0010` is already generated and applied.
- **PostgreSQL `pg` client:** used once through Node.js to verify RLS,
  privileges, constraints, and indexes without printing connection secrets.
- **Supabase skill/docs:** used to review the current changelog and Data API/RLS
  guidance. The Phase 10 migration used the repo's direct PostgreSQL/Drizzle
  connection; no Supabase MCP mutation was used in this paused work.
- **Vercel plugin/MCP and CLI:** used in earlier phases for project inspection,
  Marketplace resources, environment variables, previews, promotion, and
  logs. Resume with the connected Vercel plugin when possible; use
  `vercel env ls`, `vercel env add`, `vercel deploy`, and deployment inspection
  from the linked project. Never print secret values.
- **Supabase on Vercel:** `codev-db` is the connected Marketplace PostgreSQL
  resource. Use the Supabase connector for project inspection/advisors and
  Drizzle for committed application migrations.
- **AWS CLI and CloudFormation scripts:** earlier runtime phases used the local
  AWS account (`014576992564`, `us-east-2`) and `infra/aws/deploy.sh`. Use
  `aws sts get-caller-identity` before AWS work and keep changes scoped to the
  CoDev stack. No AWS CLI action is needed for the first Phase 10 resume step.
- **GitHub App / Chrome computer control:** earlier phases used authenticated
  Chrome for GitHub App registration, permission approval, and installation.
  Use browser control only for manual authenticated checks that APIs/CLIs
  cannot complete, and pause for any new consent or permission grant.
- **Git:** use `git diff`, `git status`, and non-destructive commits/pushes.
  Do not reset the paused worktree. The expected deployment flow is verified
  commit → push → preview → production.

## Deferred Beyond the Demo

- Browser preview-port forwarding
- Native desktop or mobile applications
- Semantic duplicate-task matching
- Billing and enterprise RBAC/SSO
- Multi-host sandbox scheduling and multi-region failover
