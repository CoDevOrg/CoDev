# CoDev product overview

**Status:** Current product summary  
**Updated:** 2026-10-04

CoDev is a browser-based shared workspace for people and AI agents building
software together. It brings code, agent conversations, terminals, Git changes,
and collaborators into one place, so a team can follow and guide work while it
happens.

## Product surfaces

- **Workspaces** are the primary coding environment. A member creates a blank
  workspace or starts from a GitHub repository. Each workspace has one shared
  cloud machine and filesystem used by its members, coding agents, editor,
  terminal, and Git view. Opening a workspace wakes or resumes its machine.
  Members can invite others with a share link, use multiple agent chats, inspect
  live plans, commands and file changes, and review the working tree. The editor
  supports shared document synchronization; richer remote cursor presence is
  still future work.
- **Rooms** are private, shared AI conversations. Members can import supported
  ChatGPT, Claude, or Codex conversations, invite collaborators, and continue
  the discussion with streamed replies. They preserve the source conversation
  and its context; they are distinct from code workspaces and do not provide a
  shared repository machine.
- **Account and team settings** cover profile and preferences, connected AI
  provider accounts, GitHub, personal API keys and environment variables,
  billing, and account export/deletion. Organization settings and a separate
  admin console support organization and service administration.

## Typical workflow

1. Request access to the private beta, sign in, and connect GitHub if needed.
2. Create a workspace from a blank machine or an accessible repository.
3. Invite teammates; the owner and collaborators use the same workspace state.
4. Choose a connected agent/provider, guide its work, and inspect its output in
   chat, files, terminal, and Git.
5. Review the changes together, then continue the work in the repository.

Members can also import an existing AI conversation into a Room when the goal is
to collaborate around a discussion rather than work directly in a repository.

## Product and account model

CoDev currently offers an Individual subscription. The workspace owner pays for
compute and agent access; invited collaborators can join without their own plan.
The current limits are up to two owned workspaces and 1,000 VM minutes per UTC
month across those workspaces. Shared workspace usage is charged to its owner.
Provider subscriptions and API usage may have separate costs with those
providers. See [Billing](../BILLING.md) for exact access rules.

Agent credentials are connected per member and turns use the requesting
member's provider credential. Workspace members share the code and activity,
not each other's personal provider accounts. GitHub credentials stay in the
control plane rather than being placed in the guest machine.

## System shape

The web app is a Next.js application deployed to Cloudflare Workers for
`trycodev.com` and to Vercel for Vercel-hosted endpoints. PostgreSQL stores
accounts, memberships, workspaces, conversations, and product state. Active
Gen 2 workspaces run in isolated Azure Firecracker guests managed by the Rust
orchestrator. Gen 2 is the current workspace generation; the old Gen 1
application has been removed. See [Gen 2 workspace](../gen2-workspace.md) and
[hosting](../WEB_HOSTING.md) for implementation details.

## Scope boundary

The current product centers on shared workspaces, imported conversation Rooms,
agent use, and reviewing work together. The broader product vision includes
issue-linked workspaces, a shared engineering knowledge layer, duplicate-work
detection, coordinated specialist agents, incident response, enterprise-wide
governance, and organization memory. Treat these as future direction unless
current code or a current-status document confirms a capability is shipped.
The [enterprise feature vision](./ENTERPRISE_FEATURES.md) is explicitly a
roadmap, not a shipped-feature list.

## Guidance for agents working in this repository

Treat `docs/gen2-workspace.md`, the feature READMEs under `apps/web/lib/`, and
the code as the source of truth for current behavior. The top-level `PRD.md`
contains earlier architectural plans and may not reflect the active product.
Preserve the shared-workspace security and durability rules in `AGENTS.md`, and
update [the docs index](../README.md) when adding or moving documentation.
