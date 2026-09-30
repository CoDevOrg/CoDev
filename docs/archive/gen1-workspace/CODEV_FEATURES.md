# CoDev feature inventory

Last reviewed: 2026-09-20

CoDev is a hosted, browser-first software-development workspace where people
and AI coding agents work in the same repository context. It combines cloud
workspaces, an embedded Orca IDE, collaborative editing, shared agent sessions,
isolated worktrees, review workflows, chat, provider connections, and operational
controls.

This inventory summarizes the current repository. It distinguishes implemented
capabilities from locally verified, feature-gated, experimental, and planned
work. An implemented backend or UI does not necessarily mean that a feature is
enabled for every production account.

## 1. Accounts, identity, and access

- Email/password sign-up and sign-in, including password reset and the ability
  to add a password to an OAuth-created account.
- Google and GitHub sign-in, with account linking so multiple sign-in methods
  can resolve to the same CoDev user.
- GitHub account connection independent of the user's primary sign-in method.
- Beta access-request/waitlist flow and admin approval tooling.
- Authenticated CLI device authorization with expiring device codes and local,
  permission-restricted token storage.
- Workspace roles and server-enforced permissions for owners, co-steerers,
  reviewers, and viewers. Permissions separately cover viewing, editing,
  terminal access, agent operation, review, merge/publication, and access
  management.
- Revocable, expiring workspace invitations by link or identity, with role
  selection and one-time acceptance.
- Workspace member lists, role changes, removal, and realtime membership
  refresh. The native Orca role-management UI exists, but its final two-member
  production verification is deferred.

## 2. Workspace creation and lifecycle

- Create a blank workspace or create one from a repository available through a
  GitHub App installation.
- Repository and installation picker with repository search.
- Workspace dashboard with search, status/type filters, grid and list views,
  collaborator presence, recent activity, and active/provisioning counts.
- Disposable, isolated Firecracker workspace sandboxes hosted on Azure.
- Runtime states for pending, provisioning, ready, hibernated, stopping,
  stopped, and failed workspaces, with retry and recovery paths.
- Start, wake, heartbeat, hibernate, stop, restore, synchronize, and delete
  workspace lifecycle operations.
- Durable workspace storage and restoration after hibernation or host loss.
- Warm reconnect path that can reuse a running Orca session without waiting on
  unrelated provisioning work.
- Workspace-open timing instrumentation for authentication, authorization,
  lookup, quota, host/session, credential, connection, and metering stages.
- VM-minute metering, member allowances, quotas, and remaining-credit display.
- Runtime readiness and health checks for the website, database, realtime
  service, orchestrator, and sandbox infrastructure.

## 3. Browser IDE and developer tools

- Embedded, authenticated Orca workspace at `/workspaces/<workspaceId>`; CoDev
  is a hosted website, not a downloadable desktop product.
- File explorer, source editor, tabs, source control, checks, agents, workspace
  board, activity, settings, and status surfaces inside Orca.
- File listing, text search, file open/save, revision-checked writes, file
  history, and explicit save-conflict handling.
- Git status, diffs, file-at-HEAD inspection, branch listing, branch checkout,
  commits, and branch-aware worktree operations.
- Interactive PTY terminal with streamed output, input, resize, ordered replay,
  reconnect support, and a request/poll fallback transport.
- Bounded command execution and workspace-relative working directories.
- Safe preview proxy for applications and assets running in the workspace,
  including access to hibernated snapshots where available.
- Light and dark themes, responsive layouts, keyboard/focus support, reduced
  motion handling, and accessible status labels.
- Feedback widget for bug reports, workflow feedback, feature requests, and
  experience ratings.

### Current architecture limitation

The interactive IDE session and backend agent sandboxes currently use separate
filesystems. A one-filesystem Firecracker runtime is planned, but remains gated
on isolation, recovery, migration, and performance work. CoDev deliberately
keeps the Vercel control plane separate from the Azure execution plane.

## 4. Realtime collaboration

- Named workspace presence with join/leave state, active file, cursor, and text
  selection information.
- Live collaborative text editing using Yjs, with durable document snapshots,
  state vectors, and awareness state.
- Native collaboration WebSocket protocol plus a standalone Hocuspocus/Yjs
  service option.
- Reconnect and resubscribe using durable cursors/state vectors, with missed
  event replay and duplicate suppression.
- External filesystem-change reconciliation and explicit conflicts that retain
  both the collaborative and filesystem versions.
- Conflict resolution by choosing the collaborative version, filesystem
  version, or explicitly merged contents.
- Realtime workspace projection updates for agents, team membership,
  coordination, presence, and activity, with REST refresh fallback.
- Follow another collaborator's file and see remote editor decorations in the
  native Orca workspace.
- Share dialog showing people with access and creating co-steer, reviewer, or
  viewer invitations.

## 5. AI agent sessions

- Create durable coding-agent sessions with a name, prompt, provider, model,
  attachments, and optional issue context.
- OpenAI/Codex, Anthropic/Claude, Cursor, Amazon Bedrock, Azure Foundry, and
  configured custom-provider backend support. Availability depends on
  deployment configuration and credentials.
- Shared, ordered agent transcript showing the provider, owner, model,
  worktree, state, prompts, streamed output, tool calls/results, and usage
  metadata when available.
- Attribute prompts and actions to the collaborator who initiated them.
- Queue follow-up instructions while a turn is running and process them in
  order.
- Interrupt or stop running work while retaining the last completed action and
  a reviewable state.
- Refresh/reconnect recovery for transcripts, queued instructions, stream
  positions, and turn state without duplicating a provider call.
- Branch an agent session from an earlier turn into a new isolated session.
- Start a fresh chat while retaining the relevant repository context.
- Agent attachments with server-side validation and bounded sizes.
- Provider-neutral durable events for turns, status, output, tool calls, tool
  results, errors, cancellations, and usage/cost data.
- Provider capability flags; unsupported queue/interrupt controls are disabled
  with an explanation.
- Explicit provider boundaries when switching providers so transcripts do not
  imply that hidden model context moved between providers.
- Per-turn authorization and connection preflight; revoked or unavailable
  credentials block the next turn without corrupting the existing session.
- Rate limits, concurrent-turn limits, and actionable capacity errors.
- Bug-report capture for agent failures.

## 6. Parallel agents, branches, and coordination

- Up to three concurrent agent slots per workspace, with server-side rejection
  of a fourth active session.
- Workboard/Mission Control showing each slot's task, owner, provider, status,
  worktree, and elapsed time.
- An isolated Git worktree for each agent session so proposed changes do not
  directly mutate the integration checkout.
- Branch/worktree creation, lookup, navigation, status, cleanup, and discard.
- Path and directory claims before agent writes, including intent, revision,
  expiry, and owner information.
- Detection of exact and overlapping claims, visible contested state, blocked
  unsafe writes/merges, reassignment, cancellation, and explicit override
  flows.
- Typed coordination messages for claim requests/responses, notes, and
  handoffs, with delivered/resolved state.
- Automatic claim release when an agent stops, fails, or times out, while
  preserving a checkpoint for review.
- Workspace Brain records for shared facts and detected overlap, with an
  adjudication path for overlap warnings.
- Coordination MCP endpoint and tools so agents can participate in the same
  claims, messages, workboard, and workspace-brain model.

### Branches-first experience

A branches-first workspace overview and branch shell are implemented and
verified locally. They show branch owner, agent count/provider/status, changed
files, activity, code, chat, source control, agents, and an optional terminal,
with deep links and recovery states. Production rollout is still pending.

## 7. Review, integration, and GitHub delivery

- Freeze an agent worktree into an immutable review checkpoint with base/head
  revisions and a SHA-256 diff digest.
- Binary-safe diff summaries, affected-path lists, text deltas, and test
  summaries.
- File- and line-specific review comments linked to an agent session.
- Rebase an agent worktree onto the integration checkout.
- Detect and reject stale checkpoints before merge.
- Integrate exactly the reviewed content once, with revision and actor
  attribution.
- Discard a proposal idempotently, remove its worktree, and release its claims
  without changing the integration checkout.
- Publish a safe `codev/` branch to GitHub and track publication attempts.
- Create and inspect GitHub pull requests from reviewed workspace changes.
- Export repository/workspace changes through the control plane without
  exposing GitHub installation credentials to the browser or sandbox.
- Audit who requested, reviewed, merged, discarded, or published a change.

## 8. Activity, audit, and recovery context

- Durable workspace and agent event storage.
- Orca Activity sidebar with filtering and links to related files, sessions,
  diffs, and checks.
- Activity/audit events for membership, agent, claim, review, merge, discard,
  publication, lifecycle, and selected credential actions.
- Standalone workspace activity view and realtime activity invalidation.
- Workspace restore controls for individual files or the full workspace.
- The broader chronological recovery timeline is still in progress; the
  current collaborative-IDE task is to persist and render its first unified
  chronological event.

## 9. Shared chat rooms and conversation import

- Lightweight collaborative chat rooms separate from coding workspaces.
- Import a public ChatGPT share link, preview its transcript and attachments
  read-only, and create a CoDev room from it.
- Room list and room switcher.
- Shared room transcript, participant avatars, composer, streaming replies,
  and model/provider details.
- Invite people to a room with expiring, one-time invitation links.
- Reply workflows that retain imported conversation context and expose clear
  provider/reply errors.
- Team chat channels inside workspaces, including channel creation, messages,
  agent participation, roster data, and coordination state.

## 10. Provider accounts, credentials, and environment

- Separate provider setup for chat rooms and coding workspaces because those
  surfaces have different execution and credential boundaries.
- Personal and workspace/organization fallback credentials, with personal
  credentials taking precedence.
- Add, validate, replace, and revoke OpenAI, Anthropic, Cursor, and supported
  workspace credentials.
- Amazon Bedrock access through a configured IAM role.
- Official Codex and Claude CLI authentication via the CoDev CLI, scoped to an
  individual account or deliberately shared with an organization.
- Hosted Codex and Claude subscription bridges behind deployment feature
  flags.
- Cursor connection flow and API-key fallback.
- Credential metadata shows connection type, supplier, and safe last-four
  information, but never returns the stored secret.
- Envelope encryption at rest using Azure Key Vault in production, redaction,
  authenticated scope binding, and server-only credential handling.
- Personal encrypted environment variables with write-only values after save.
- Credential revocation and provider-connection audit events.
- OAuth infrastructure with state/PKCE-style protections where the provider
  flow supports it. Some provider OAuth surfaces remain documented,
  feature-gated, or fixture-only rather than generally enabled.

## 11. Session import and portability

- Import a versioned, provider-neutral session capsule containing repository
  identity, normalized transcript, handoff data, declared repository state,
  attachments, and an opaque provider payload reference.
- Strict capsule size, path, file-type, ordering, digest, and transport
  validation.
- Idempotent, encrypted durable storage of imported session artifacts.
- Imported-session page showing the normalized handoff, repository state, and
  recent transcript while withholding provider-native payloads and attachment
  bytes.
- Restore the declared patch and untracked files into a new isolated worktree
  with checksum, base-commit, collision, symlink, and cleanliness checks.
- Retry repository restoration or explicitly continue transcript-only after a
  recorded conflict/unavailable result.
- Codex-session import route and a dormant resume dialog.

Exact provider-native resume, provider rehydration, and launching a fresh
managed continuation from an imported capsule are not yet implemented.

## 12. Mobile client (experimental)

The repository contains an Expo/React Native client. It currently provides:

- GitHub, Google, and email/password sign-in/sign-up.
- Workspace list with pull-to-refresh and workspace creation from GitHub or a
  blank workspace.
- Agent-session list, create-agent form, status display, activity feed,
  follow-up prompts, and interrupt control.
- An Attention tab for sessions that are waiting, failed, or otherwise require
  action, with periodic refresh and badge count.
- Push-token registration and mobile attention APIs.
- A mobile Orca terminal with workspace wake/connect behavior, scrollback,
  streamed output, and terminal input.
- Account sign-out.

The mobile app should be treated as experimental: its README is still the Expo
starter document and its package currently declares no automated tests.

## 13. Administration and operations

- Admin console for access requests/waitlist management.
- Plan assignment plus organization- and user-level feature overrides, optional
  expiry, active-override listing, and override history.
- User directory with sign-in methods, join/last-seen data, and visit counts.
- Workspace directory with owners, members, status, runtime usage, and allocated
  cost.
- Compute-credit reporting, member allowances, platform overhead, and tracked
  Azure spend.
- Traffic analytics, top pages, and recent visits.
- Feedback forwarding into GitHub when configured.
- Health/readiness endpoints, structured observability, rate limiting, and
  lifecycle cron support.
- Organization settings shells for identity, members, agents, integrations,
  billing, and audit. Agent credentials and billing usage are functional;
  several broader organization pages still describe future controls rather
  than providing full management UI.

## 14. Security and isolation

- Vercel-hosted authenticated control plane separated from the Azure-hosted
  runtime and Firecracker guests.
- Per-workspace microVM isolation and per-agent Git worktree isolation.
- Server-side membership checks on workspace APIs and realtime subscriptions;
  the client cannot grant itself a role.
- No provider, GitHub, database, KMS, or orchestrator credentials are returned
  to the browser or Firecracker guest.
- Encrypted secrets with contextual binding, write-only inputs, safe metadata,
  and log/transcript redaction.
- Signed, short-lived collaboration tokens and authenticated WebSocket/SSE
  channels.
- Revision, digest, idempotency, and compare-and-set protections around file
  saves, session imports, reviews, merges, and lifecycle transitions.
- Path validation, file-size limits, binary-safe handling, backpressure, rate
  limits, quotas, and bounded command/transport payloads.
- Privacy and data-retention pages.

## 15. Planned or incomplete feature areas

The following are product direction or active backlog, not generally available
features today:

- One authoritative filesystem/runtime shared by the IDE, terminals, and
  backend agents.
- Full chronological recovery timeline with complete reconnect/resume behavior.
- Shared-terminal input ownership and handoff between collaborators.
- Workspace-wide guardrail configuration for concurrent agents, turn duration,
  provider spend, and incident freeze/unfreeze.
- Production rollout of the branches-first interface.
- Exact provider-native continuation of imported sessions.
- Git-through-control-plane proxying without credentials in the guest.
- Task briefs, richer handoffs, attached test evidence, reusable workspace
  templates, notifications, and semantic duplicate-work warnings.
- Complete organization management UI, enterprise RBAC, SSO/SCIM, private
  networking, configurable retention/legal hold, approval policies, and
  exportable compliance evidence.
- Cross-workspace repository and organization intelligence, reusable
  engineering memory, and permission-aware semantic search.
- Incident rooms, security-remediation rooms, large-migration coordination,
  customer-escalation workspaces, follow-the-sun handoffs, and automatic
  postmortem generation.
- Deeper integrations with issue trackers, observability/incident systems,
  chat platforms, CI/CD, deployments, feature flags, and enterprise secrets or
  identity systems.

## Source-of-truth notes

- Current product overview: [`../README.md`](../README.md)
- Current backend/frontend contract:
  [`BACKEND_FRONTEND_INTEGRATION.md`](./BACKEND_FRONTEND_INTEGRATION.md)
- Collaborative IDE backlog and promise:
  [`collaborative-ide/COLLABORATIVE_IDE_FEATURES.md`](./collaborative-ide/COLLABORATIVE_IDE_FEATURES.md)
- Implementation/verification ledger:
  [`collaborative-ide/COLLABORATIVE_IDE_TASK_STATE.md`](./collaborative-ide/COLLABORATIVE_IDE_TASK_STATE.md)
- Session portability status:
  [`agent-session-portability.md`](./agent-session-portability.md)
- Long-range enterprise vision (planned, not shipped):
  [`product/ENTERPRISE_FEATURES.md`](./product/ENTERPRISE_FEATURES.md)
