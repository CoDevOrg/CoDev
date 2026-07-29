# Product Requirements Document (PRD): CoDev v1.0

## 1. Overview & Vision

**CoDev** is a real-time, browser-based workspace that turns AI coding into a multiplayer experience—acting as the **"Google Docs for AI software development."**

Instead of developers working in isolation on local setups (Cursor, Claude, Codex) or waiting on black-box agent runs (Devin), CoDev allows engineering teams to generate an ephemeral cloud sandbox, bring their preferred AI models, and share live agent sessions via a link. Teammates can co-steer agents, inspect streaming terminals, edit code, and prevent duplicate effort in real time.

## 2. Problem Statement

1. **Isolated & Single-Player AI Workflows:** Current AI coding tools operate locally on individual laptops. Teammates have zero visibility into what AI agents are generating until a PR is submitted.
2. **Duplicate Work & Collision:** Two developers frequently spend hours using AI agents to fix the exact same bug or refactor the same module in parallel without knowing it, leading to wasted API costs and merge conflicts.
3. **Passive Waiting & Friction in Agent Guidance:** Long-running autonomous agent sessions often drift off-track or encounter errors. Teammates cannot easily step in to help re-steer an agent without manually cloning branches and configuring local environments.

## 3. Core User Personas

- **The AI-Native Developer:** Regularly relies on tools like Claude, Cursor, or Codex; wants seamless collaboration and instant cloud environment spinning without "works on my machine" hassles.
- **Tech Leads & Senior Engineers:** Need live visibility into agent execution, terminal output, and code diffs so they can guide junior devs or AI agents before bad code is committed.
- **Collaborative Dev Teams:** Engineering groups working on complex, multi-file codebases who want to avoid redundant efforts and ship faster together.

## 4. Key Functional Requirements

### 4.1. Workspace & Cloud Sandbox Engine

- **One-Click Cloud Sandbox:** Instantly provision disposable, isolated microVM environments from a Git repo in seconds.
- **Web-Based IDE & Terminal:** Full browser-based code editor paired with a streamed, interactive cloud terminal.
- **Environment Parity:** Standardized runtime environment accessible from any modern browser.

### 4.2. Multiplayer & Collaboration Engine

- **Shareable Workspace Links:** Invite teammates to join a live workspace via a single URL.
- **Real-Time Presence:** Google Docs-style multiplayer cursors, user presence avatars, and active file highlights.
- **Conflict & Collision Alerts:** Active notifications showing if another team member or agent is actively working on the same file, issue, or agent prompt.

### 4.3. Shared Agent Session & Co-Steering

- **Shared Agent Context:** All participants in a session view the exact same live agent execution state.
- **Co-Steering & Prompting:** Multiple developers can send prompts, interrupt runaway agent loops, or adjust instructions mid-run.
- **Live Terminal & Diff Inspection:** Real-time streaming of terminal outputs, test runs, and side-by-side code diff approvals.

### 4.4. "Bring Your Own Tool/Model" (BYO-AI) Architecture

- **Model Agnostic:** Native support for plugging in preferred LLM keys or integrations (Claude, Codex, OpenAI, custom internal models).
- **Tool Flexibility:** Support for developers using different interface paradigms while operating inside the same shared microVM.

## 5. Technical Architecture & Tech Stack

| Layer                    | Technology                        | Usage / Purpose                                                                             |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------- |
| **Frontend UI**          | **Next.js (React) & TypeScript**  | Fast, responsive web client rendering and dashboard interface.                              |
| **Code Editor**          | **Monaco Editor**                 | Powers VS Code-like browser editing experience with full syntax highlighting.               |
| **Terminal Emulator**    | **xterm.js**                      | Streams raw PTY terminal output to the browser in real time.                                |
| **Multiplayer Sync**     | **Yjs (CRDTs) + WebSockets**      | Real-time document conflict resolution, multiplayer cursors, and presence.                  |
| **MicroVM Engine**       | **Firecracker / Apple Container** | Ephemeral, isolated, sub-second runtime sandboxes hosted in the cloud.                      |
| **Orchestration**        | **Rust**                          | Memory-safe daemon managing VM pooling, state sync, and sandbox lifecycles.                 |
| **AI Gateway Service**   | **Node.js / Python Middleware**   | Routes user/agent prompts, handles BYO-API key authentication, and streams model responses. |
| **Cloud Infrastructure** | **AWS (EC2/EKS) & Cloudflare**    | Edge routing, global WebSocket connections, and microVM host cluster hosting.               |

## 6. Non-Functional Requirements

- **Performance & Latency:** Real-time editor and terminal sync with $<100\text{ms}$ collaboration latency.
- **Security & Isolation:** Strict tenant isolation at the microVM level; encrypted ephemeral sandboxes destroyed upon workspace closure.
- **Reliability:** Auto-saving workspace states and session recovery in case of network disconnects.

## 7. Out of Scope for Beta (V1)

- Native desktop app (Focus is strictly on browser-first delivery).
- Proprietary base AI model training (CoDev leverages existing top-tier foundation models via BYO key architecture).
- Deep enterprise RBAC and SSO (Basic team/link permissions for V1 design partners).

## 8. Success Metrics & KPIs

- **Active Shared Sessions:** Number of collaborative, multi-user agent sessions created per team/week.
- **Co-Steering Rate:** Frequency of mid-run user interventions/prompts during agent executions.
- **Duplicate Work Reduction:** Reduction in overlapping branch commits and merge conflicts reported by design partners.
- **Beta Retention:** Weekly active usage across early design partner teams.
