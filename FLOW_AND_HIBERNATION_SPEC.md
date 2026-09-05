# FLOW_AND_HIBERNATION_SPEC.md

> **Document Scope:** Full End-to-End User Experience, Google Docs-Style Sharing/Permissions Model, and Auto-Hibernation Architecture for **CoDev**.

---

## 1. End-to-End Product Flow: The "Google Docs" Developer Flow

The goal of CoDev is to make software development with AI agents as smooth and instant as sharing a Google Doc—eliminating local setup, manual environment configuration, and single-player isolation.

```text
┌───────────────────────────┐
│ 1. Instant Landing & Auth │  Sign in with 1-click via GitHub / Google SSO (Clerk)
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ 2. Create Workspace       │  Pick a repo or start blank -> Sandbox boots in <2s
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ 3. Invite & Share         │  Share via Link, Email, or GitHub handle (OpenFGA)
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ 4. Live Collaborative Run │  Co-steer agents, inspect terminals, edit code in real-time
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ 5. Export / Handoff       │  1-click GitHub Pull Request creation or Cloud Deploy
└───────────────────────────┘

```

---

### Step 1: Onboarding & Instant Landing

- User lands on `codev.ai` and clicks **"Sign In with GitHub"** or **"Sign In with Google"** (handled via **Clerk**).
- Zero local keys, SSH setup, or desktop installations required.

### Step 2: One-Click Workspace Creation

- Click **"New CoDev Workspace"**. Select a GitHub repository or template.
- In <2s, an isolated AWS Firecracker cloud sandbox boots with pre-installed repository dependencies, environment variables, and pre-warmed agent contexts.

### Step 3: Google Docs-Style Sharing & Invitations

Clicking the **"Share"** button in the top navigation bar opens a share dialog designed exactly like Google Docs:

```text
┌─────────────────────────────────────────────────────────────┐
│ Share "auth-refactor-service"                              │
├─────────────────────────────────────────────────────────────┤
│ Add people or GitHub handles:                               │
│ [ alex@company.com or @octocat                    ] [Invite]│
│                                                             │
│ People with access:                                         │
│ 👤 Yousef (You)                       Owner                 │
│ 👤 Sarah (sarah@co.com)              Co-Steer (Editor) ▾  │
│ 👤 Alex (@alex_dev)                  Reviewer          ▾  │
│                                                             │
│ General access:                                             │
│ 🔗 Anyone with the link                Co-Steer (Editor) ▾  │
│    [ Copy Link ]                                            │
└─────────────────────────────────────────────────────────────┘

```

#### Authorization & Roles (Powered by **OpenFGA**):

Permissions are governed by an **OpenFGA** (Google Zanzibar) relationship model:

```fga
model
  schema 1.1

type user

type workspace
  relations
    define owner: [user]
    define editor: [user] or owner
    define reviewer: [user] or editor
    define viewer: [user] or reviewer or viewer_from_link
    define viewer_from_link: [user]

```

- **Co-Steer (Editor):** Full permission to send prompts, interrupt runaway agents, run cloud terminal commands, and edit code.
- **Reviewer (Commenter):** Can view agent timelines, inspect live terminals, and leave inline comments/diff reviews without triggering agent runs.
- **Viewer:** Read-only access to live execution streams and previews.

### Step 4: Co-Steering & Collaboration

- **Multiplayer Cursors:** Yjs CRDTs track live cursors, active file views, and presence avatars in real-time.
- **Cross-Provider Co-Steering:** User A prompts an agent using **Claude 3.5 Sonnet**. User B sees the live output stream and sends a prompt using **GPT-4o**—both execute inside the **same shared agent thread and microVM context**.

### Step 5: Export / Finishing the Project ("The Google Doc Export")

When the task is complete, users export their work directly from the browser:

- **1-Click GitHub PR Creation:** Clicking **"Create PR"** invokes `@octokit/rest` to commit file diffs, create a new branch, and open a Pull Request with an auto-generated AI summary of all agent actions.
- **1-Click Cloud Deployment:** Instantly deploy workspace builds directly to Vercel, Supabase, or AWS using the team's linked OAuth credentials.

---

## 2. Auto-Hibernation & Scale-to-Zero Architecture

Cloud compute (AWS EC2 Bare Metal + MicroVMs) is expensive. To keep costs at **$0.00 for idle sessions**, CoDev automatically scales active sandboxes to zero after **1 hour of inactivity** (`workspaceHibernateIdleMs` in `apps/web/lib/workspaces.ts`), without losing a single line of code, agent context, terminal log, or uncommitted diff.

---

### The Scale-to-Zero Architecture

```text
               ┌──────────────────────────────────────────────────┐
               │    WebSocket Heartbeat / Inactivity Monitor      │
               └────────────────────────┬─────────────────────────┘
                                        │
                         No activity for 1 Hour
                                        │
                                        ▼
               ┌──────────────────────────────────────────────────┐
               │      EXECUTE FIRECRACKER SNAPSHOT (E2B)          │
               │  • Freeze process RAM & state to disk storage     │
               │  • Persist binary Yjs CRDT document to Database  │
               │  • Destroy active vCPU & RAM compute allocation  │
               └────────────────────────┬─────────────────────────┘
                                        │
                                        ▼
               ┌──────────────────────────────────────────────────┐
               │     SANDBOX ENTERED HIBERNATION ($0 Compute)     │
               └────────────────────────┬─────────────────────────┘
                                        │
                         User re-opens workspace link
                                        │
                                        ▼
               ┌──────────────────────────────────────────────────┐
               │              SUB-SECOND REHYDRATION              │
               │  1. DB restores durable workspace and agent state │
               │  2. Firecracker resumes RAM & processes in <500ms │
               │  3. PTY and Yjs clients reconnect through APIs     │
               └──────────────────────────────────────────────────┘

```

---

### Decoupled Dual-Layer State Model

To guarantee **zero lost context or state**, state persistence is split into two distinct layers:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              CODEV STATE                               │
├───────────────────────────────────┬────────────────────────────────────┤
│ LAYER A: UI & CONVERSATION STATE  │ LAYER B: COMPUTE EXECUTION STATE   │
│ (PostgreSQL + Yjs CRDTs)          │ (E2B / AWS Firecracker Snapshots)  │
├───────────────────────────────────┼────────────────────────────────────┤
│ • Agent Conversation History      │ • Running Background Processes     │
│ • User Comments & Prompts         │ • Uncommitted Filesystem Diffs     │
│ • Diff Cards & Tool Cards         │ • Active Terminal (PTY) Buffer     │
│ • Presence & Access Permissions   │ • Memory (RAM) Execution State     │
└───────────────────────────────────┴────────────────────────────────────┘

```

#### 1. Layer A: UI & Conversation State (Database Layer)

- **Technology:** **Yjs CRDTs + PostgreSQL + `@hocuspocus/extension-database`**
- **Mechanism:** Every prompt, tool card, code comment, and agent action is continuously written as binary CRDT updates (`Uint8Array`) to PostgreSQL.
- **Instant Load Guarantee:** When a user clicks a hibernated workspace link (`codev.ai/ws/session-123`), the Next.js frontend fetches the Yjs binary state from PostgreSQL and **renders the entire agent history, chat thread, and code diffs in <100ms**, even before the execution VM wakes up.

#### 2. Layer B: Compute & Execution State (Sandbox Snapshot Layer)

- **Technology:** **E2B Auto-Pause Engine / AWS Firecracker MicroVM Snapshots**
- **Configuration:** Sandboxes are instantiated with a 1-hour timeout and auto-resume hooks:

```typescript
import { Sandbox } from "e2b";

// Instantiate Cloud Sandbox with 1-Hour Inactivity Timeout
const sandbox = await Sandbox.create({
  timeoutMs: 60 * 60 * 1000, // 1 hour in ms
  lifecycle: {
    onTimeout: "pause", // Freezes process RAM + Filesystem to NVMe/S3
    autoResume: true, // Wakes sandbox up in <500ms upon incoming traffic
  },
});
```

- **Hibernate Logic:** When 1 hour passes without a WebSocket heartbeat, the E2B daemon executes a complete Firecracker RAM freeze and destroys the vCPU compute allocation.
- **Rehydration Logic:** When a user or agent executes an action on a hibernated workspace, the backend issues `sandbox.connect()` (or auto-resume intercepts the WebSocket), restoring memory and running terminal processes in **<500ms**.

---

## 3. Detailed Data Schemas

### 1. Workspace State & Heartbeat Schema (`/packages/shared-types/src/workspace.ts`)

```typescript
export type WorkspaceStatus = "ACTIVE" | "HIBERNATED" | "CREATING";

export interface WorkspaceMetadata {
  id: string;
  name: string;
  ownerId: string;
  githubRepo: string;
  status: WorkspaceStatus;
  sandboxId: string; // E2B / Firecracker Sandbox Identifier
  lastActivityAt: string; // ISO Timestamp for heartbeat tracking
  hibernateAt: string; // Expected timeout timestamp (lastActivityAt + 1 hour)
  createdAt: string;
}
```

### 2. Share Invitation Schema (`/packages/shared-types/src/share.ts`)

```typescript
export type WorkspaceRole = "CO_STEER" | "REVIEWER" | "VIEWER";

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  invitedByUserId: string;
  inviteeEmail?: string;
  inviteeGithubHandle?: string;
  role: WorkspaceRole;
  token: string;
  acceptedAt?: string;
  expiresAt: string;
}
```

---

## 4. Execution Step Checklist for AI Agent

### Step 1: Implement OpenFGA Authorization & Clerk Share Modal

- [x] Create OpenFGA DSL model for `workspace` relations (`owner`, `editor`, `reviewer`, `viewer`).
- [x] Build `ShareDialog.tsx` with inputs for email, GitHub handles, and a single-use link generator.
- [x] Wire workspace invite/member routes to write and enforce OpenFGA tuple relationships.

### Step 2: Implement Hocuspocus DB Persistence

- [x] Add `@hocuspocus/extension-database` to the `hocuspocus-server` app.
- [x] Implement `fetch` and `store` hooks to serialize binary Yjs document state directly to PostgreSQL `workspace_state_documents` on every client update.

### Step 3: Implement Idle Hibernation Engine

- [x] Propagate `timeoutMs: 14400000` and `lifecycle: { onTimeout: 'pause', autoResume: true }` through the Firecracker sandbox lifecycle contract.
- [x] Implement the workspace heartbeat endpoint and Redis liveness monitor, with PostgreSQL fallback.
- [x] Snapshot the guest filesystem plus Firecracker RAM/process state before destroying the VM; restore from the snapshot on the next action.

### Step 4: Implement 1-Click Export & PR Engine

- [x] Integrate `@octokit/rest` inside the workspace export route.
- [x] On export trigger: pull git diffs from the active microVM, push a clean branch to the user's GitHub repository, and open a Pull Request with an AI-generated change summary.

The remaining validation step is environment-specific: run a Linux/KVM Firecracker smoke test on the AWS host to measure snapshot-restore latency and verify host power-off after the final sandbox is destroyed. The repository checks validate the control-plane behavior and Linux-target compilation, but this Mac workspace cannot exercise `/dev/kvm` or EC2 power-state transitions.
