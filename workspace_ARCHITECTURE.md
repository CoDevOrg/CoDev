# CoDev: Master System Architecture & Execution Blueprint

> **System Overview:** An agent-first, multiplayer browser workspace where engineering teams co-steer AI agents in real time, share context across model providers (Claude, Cursor, Codex), and execute code in isolated AWS microVMs—built with zero-friction link sharing like a Google Doc.

---

## 1. Complete Tech Stack & Open-Source Repositories

| Component | Technology / Tool | Repository / Package | Primary Function |
| --- | --- | --- | --- |
| **Frontend Framework** | Next.js 14+ (App Router) | [`vercel/next.js`](https://github.com/vercel/next.js) | Main application shell, route handling, and server-side link rendering. |
| **Agent UI & Canvas** | Assistant-UI | [`assistant-ui/assistant-ui`](https://github.com/assistant-ui/assistant-ui) | Streaming agent thought streams, tool execution cards, and generative UI. |
| **Multiplayer Sync** | Yjs + Hocuspocus | [`yjs/yjs`](https://github.com/yjs/yjs) / [`ueberdosis/hocuspocus`](https://github.com/ueberdosis/hocuspocus) | CRDT state synchronization for presence, cursor sync, and shared session state. |
| **Code Editor** | Monaco Editor | [`suren-atoyan/monaco-react`](https://github.com/suren-atoyan/monaco-react) | Embedded VS Code editor inside the collapsible workspace drawer. |
| **Terminal Emulator** | xterm.js | [`xtermjs/xterm.js`](https://github.com/xtermjs/xterm.js) | Browser terminal streaming raw PTY output over WebSockets from microVMs. |
| **Code Diff Viewer** | Git Diff View | [`Will-In-Wi/git-diff-view`](https://github.com/Will-In-Wi/git-diff-view) | Renders side-by-side or unified code diff cards inside the agent thread. |
| **AI Router & Normalizer** | Vercel AI SDK | [`vercel/ai`](https://github.com/vercel/ai) | Provider-agnostic LLM streaming, function calling, and BYO API key routing. |
| **Sandbox Engine** | E2B / AWS Firecracker | [`e2b-dev/E2B`](https://github.com/e2b-dev/E2B) / [`firecracker-microvm/firecracker`](https://github.com/firecracker-microvm/firecracker) | Sub-second isolated cloud microVM runtimes hosted on AWS EC2 Metal. |
| **OAuth Integration Vault** | Nango | [`NangoHQ/nango`](https://github.com/NangoHQ/nango) | Secure OAuth token lifecycle management for team APIs (GitHub, Supabase, Vercel). |
| **Cache & Pub/Sub** | Redis | `ioredis` / Amazon ElastiCache | WebSocket room state coordination across backend instances. |

---

## 2. High-Level Architecture Diagram

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             CODEV FRONTEND (Next.js)                             │
│                                                                                  │
│   ┌──────────────────────────────┬────────────────────────────────────────────┐  │
│   │ Assistant-UI (Agent Canvas)  │ Monaco Editor (Yjs Cursors / Code Drawer)  │  │
│   └──────────────┬───────────────┴─────────────────────┬──────────────────────┘  │
└──────────────────┼─────────────────────────────────────┼─────────────────────────┘
                   │ WebSockets                          │ WebSockets (PTY Stream)
                   ▼                                     ▼
┌──────────────────────────────────────┐     ┌─────────────────────────────────────┐
│      HOCUSPOCUS SYNC SERVER          │     │    AWS FIRECRACKER MICROVM HOST     │
│  (AWS ECS / Fargate + ElastiCache)   │     │      (AWS EC2 .metal Instances)     │
│  • Yjs Room State Management         │     │  • Isolated Ephemeral Linux VM      │
│  • Real-Time Presence & Cursors      │     │  • Pre-Warmed MicroVM Pool          │
│  • Agent Action Normalization        │     │  • Direct PTY Terminal Engine       │
└──────────────────┬───────────────────┘     └─────────────────┬───────────────────┘
                   │                                           │
                   ▼                                           │
┌──────────────────────────────────────┐                       │
│    AI & INTEGRATION GATEWAY          │                       │
│  • Vercel AI SDK (LLM Streaming)     │                       │
│  • Nango OAuth Vault (API Keys)      ├───────────────────────┘
│  • Workspace Secrets Injector        │  Environment Variables / Secret Mounts
└──────────────────────────────────────┘

```

---

## 3. Normalized Shared Agent Context Schema

To ensure multi-agent tools (Claude, Cursor, Codex) operate within a single shared timeline, all interactions map to a standardized event format.

### Unified Event Data Schema (`/packages/shared-types/src/agent-event.ts`)

```typescript
export type AgentEventType = 
  | 'USER_PROMPT'
  | 'AGENT_THOUGHT'
  | 'TOOL_CALL_INIT'
  | 'FILE_DIFF_PROPOSED'
  | 'TERMINAL_EXEC_START'
  | 'TERMINAL_EXEC_END'
  | 'INTERVENTION_PAUSE';

export interface AgentEvent {
  id: string;
  workspaceId: string;
  actor: {
    userId: string;
    userName: string;
    avatarUrl: string;
  };
  modelProvider: 'anthropic' | 'openai' | 'custom';
  modelName: string;
  type: AgentEventType;
  payload: {
    promptText?: string;
    toolName?: string;
    filePath?: string;
    diffContent?: string;
    command?: string;
    exitCode?: number;
    outputStream?: string;
  };
  timestamp: number;
}

```

---

## 4. Complete Project Directory Structure

```text
codev/
├── apps/
│   ├── web/                              # Next.js App Router (Frontend)
│   │   ├── app/
│   │   │   ├── page.tsx                  # Landing / Dashboard
│   │   │   └── ws/[sessionId]/page.tsx   # Live Collaborative Workspace
│   │   ├── components/
│   │   │   ├── canvas/                   # Assistant-UI Agent Timeline
│   │   │   │   ├── AgentCanvas.tsx
│   │   │   │   ├── DiffCard.tsx
│   │   │   │   └── TerminalCard.tsx
│   │   │   ├── editor/                   # Monaco & Yjs Cursors
│   │   │   │   └── CodeDrawer.tsx
│   │   │   └── terminal/                 # xterm.js PTY Streamer
│   │   │       └── CloudTerminal.tsx
│   │   └── hooks/
│   │       ├── useMultiplayer.ts         # Yjs & Hocuspocus connection
│   │       └── useSandboxTerminal.ts     # PTY WebSocket hook
│   │
│   └── hocuspocus-server/                # Node.js Sync & Agent Gateway Backend
│       ├── src/
│       │   ├── index.ts                  # Server entry point
│       │   ├── rooms/                    # Yjs Room Persistence
│       │   ├── agent/                    # Vercel AI SDK Router & Event Normalizer
│       │   └── sandbox/                  # E2B / AWS Firecracker Orchestrator
│       └── Dockerfile
│
├── packages/
│   ├── shared-types/                     # Typescript definitions (AgentEvent, Session)
│   └── config/                           # Shared ESLint, TS, Tailwind configs
│
├── infrastructure/
│   └── terraform/                        # AWS Provisioning
│       ├── main.tf                       # VPC, ECS Fargate, ElastiCache
│       └── ec2_metal_firecracker.tf      # EC2 Bare Metal MicroVM Host Setup
│
└── IMPLEMENTATION_PLAN.md

```

---

## 5. Sequential Execution Steps

### Phase 1: Core Cloud Sandbox Infrastructure

1. Provision an **AWS EC2 `.metal`** instance (e.g., `m7g.metal`) with Firecracker installed.
2. Configure **E2B open-source engine** or the `aws-samples/sample-e2b-on-aws` template to expose a gRPC/REST control layer for sandbox creation, file I/O, and PTY terminal attachment.
3. Verify sub-second sandbox boot times and establish raw PTY streaming over WebSockets.

### Phase 2: Backend Sync Engine & Agent Router

1. Deploy **Hocuspocus (Yjs WebSocket server)** on AWS ECS Fargate, backed by **Amazon ElastiCache (Redis)** for pub/sub scaling.
2. Implement room management logic so every workspace URL (`/ws/[sessionId]`) binds to a dedicated Yjs document.
3. Integrate **Vercel AI SDK** into the backend to route prompts to Anthropic/OpenAI APIs, streaming responses and tool call actions back into the Yjs event stream.

### Phase 3: Agent-First Canvas Frontend

1. Build the Next.js workspace page utilizing **Assistant-UI** as the primary center canvas.
2. Render generative cards inside the thread:
* **Diff Cards:** Using `git-diff-view` for side-by-side proposed file changes.
* **Terminal Execution Badges:** Displaying real-time command execution state and logs.


3. Add a **"Pause / Re-steer"** control button thathalts the active agent event stream and injects human guidance into the shared context.

### Phase 4: Embedded Editor, Terminal & Multiplayer Presence

1. Embed **Monaco Editor** and **xterm.js** into a collapsible bottom/side drawer.
2. Wire `@hocuspocus/provider` and `y-monaco` to enable real-time multiplayer cursors, presence avatars, and active file highlights.
3. Route xterm.js terminal input/output directly to the active Firecracker sandbox PTY session via WebSockets.

### Phase 5: OAuth Integration Vault & Workspace Secrets

1. Deploy **Nango** as an OAuth integration manager.
2. Connect OAuth applications for GitHub, Supabase, Vercel, and AWS.
3. Implement environment variable auto-injection: when a Firecracker sandbox boots, fetch team secrets from Nango/AWS Secrets Manager and inject them into the sandbox runtime environment.
