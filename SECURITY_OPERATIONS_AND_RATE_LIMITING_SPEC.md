# SECURITY_OPERATIONS_AND_RATE_LIMITING_SPEC.md

> **Document Scope:** Comprehensive Specification for Rate Limiting, Cost Safety, Security Hardening, Telemetry, Beta Access Control, and Privacy Assurances for **CoDev**.

---

## 1. Rate Limiting Architecture & 3-Tier Protection

To protect the platform against API abuse, runaway loops, and denial-of-service attacks, CoDev enforces rate limiting across three distinct execution layers:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 1. EDGE HTTP RATE LIMITER (Next.js Middleware + Upstash / Redis)       │
│    • Blocks DDoS, brute-force auth, and API route scraping at edge.    │
├────────────────────────────────────────────────────────────────────────┤
│ 2. WEBSOCKET & PTY STREAM LIMITER (Hocuspocus / Redis PubSub)          │
│    • Prevents message flooding in Yjs sync & terminal input streams.   │
├────────────────────────────────────────────────────────────────────────┤
│ 3. AGENT AI PROMPT LIMITER (Vercel AI SDK Router)                      │
│    • Enforces sliding-window token/prompt quotas per User & Workspace. │
└────────────────────────────────────────────────────────────────────────┘

```

---

### Rate Limit Matrix & BYOK Bypass Rules

| Layer              | Route / Channel                        | Target Limit (Sliding Window)               | Action when Exceeded                              |
| ------------------ | -------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| **Edge HTTP**      | `/api/auth/*`, `/api/workspace/create` | 10 requests / 1 min                         | HTTP `429 Too Many Requests`                      |
| **Agent Prompts**  | **Platform Key Users**                 | 30 prompts / hour                           | Prompt blocked; toast: _"Upgrade or BYO Key"_     |
| **Agent Prompts**  | **BYOK Users (Personal/Org Keys)**     | Unlimited AI Tokens (100 req/min anti-spam) | Bypasses platform limits; uses user's key         |
| **WebSocket Sync** | Hocuspocus CRDT Messages               | 100 updates / sec                           | Drops excess updates & sends backpressure warning |
| **PTY Terminal**   | Cloud MicroVM Terminal Input           | 50 keypresses / sec                         | Throttles PTY input stream                        |

---

### Implementation Code (`/lib/rate-limit.ts`)

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// API Edge Limiter
export const apiEdgeLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  prefix: "ratelimit:edge",
});

// AI Prompt Limiter (Platform Keys)
export const aiAgentLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 h"),
  analytics: true,
  prefix: "ratelimit:ai",
});

// Anti-Spam Limiter (BYOK Users)
export const byokSpamLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1 m"),
  prefix: "ratelimit:byok",
});
```

---

## 2. Five Critical Operational & Security Pillars

### Pillar 1: Security & Infrastructure Hardening

1. **AWS Metadata Service Isolation (IMDSv2):**

- **Rule:** Strictly block microVM outbound requests to `169.254.169.254` (the AWS Instance Metadata Service).
- **Implementation:** Configure Linux `iptables` rules inside the Firecracker host root network namespace:

```bash
iptables -A FORWARD -d 169.254.169.254 -j DROP

```

- **Purpose:** Prevents arbitrary code executed by AI agents or malicious users from leaking host EC2 IAM credentials.

2. **Network Egress Filtering:**

- Limit microVM network access to explicit port ranges (80, 443) and whitelist outbound dev destinations (GitHub, npm, PyPI, Vercel, Supabase).
- Block outgoing traffic on SSH (22) and SMTP (25) to prevent botnet weaponization or spam relaying.

3. **Secrets Encryption at Rest:**

- All API keys (Anthropic, OpenAI, Bedrock) and OAuth tokens (Nango) must be encrypted using **AWS KMS** before writing to PostgreSQL.
- Secrets are decrypted strictly in-memory during request dispatch and must never be output to server logs or client-side HTTP responses.

---

### Pillar 2: Cost Safety Controls & Guardrails

To prevent runaway AI loops or abusive users from inflating cloud bills:

| Guardrail                  | Enforcement Mechanism                           | Default Threshold                 |
| -------------------------- | ----------------------------------------------- | --------------------------------- |
| **Max Token Output Cap**   | Vercel AI SDK `maxTokens` parameter             | 4,096 tokens / completion         |
| **Workspace Cost Ceiling** | Billing middleware check in Redis               | $5.00 spend cap / workspace / day |
| **MicroVM Disk Quota**     | Linux ext4 storage quotas on Firecracker mounts | 10 GB per microVM instance        |
| **Concurrent VM Limit**    | Database workspace status check                 | 1 active VM per user account      |

---

### Pillar 3: In-App Telemetry & Feedback Systems

1. **Error Tracking & Performance Monitoring:**

- **Sentry:** Captures uncaught frontend React errors and Node.js WebSocket exception stack traces.
- **PostHog:** Tracks session funnels, prompt execution duration, and agent tool execution latency.

2. **1-Click "Report Agent Bug" Button:**

- Embedded inside the Assistant-UI Agent Canvas toolbar.
- **Payload Package:** Captures the last 5 agent prompt-response cycles, active terminal error logs, browser user agent, and workspace ID, filing an internal ticket automatically.

3. **Graceful Connection Recovery:**

- If a WebSocket connection drops due to network migration or VM rehydration, the frontend displays a non-intrusive banner: _"Reconnecting to workspace environment..."_ without wiping active editor tabs or chat state.

---

### Pillar 4: Beta Access Gating & Onboarding

1. **Access Control Gating:**

- Use **Clerk** domain restrictions and waitlist tokens so only approved design partners can sign in during the closed beta.

2. **Pre-Loaded Demo Playground:**

- New users are onboarded into a read-only or forkable **"Demo Playground"** workspace pre-configured with a Next.js + Supabase template.
- Allows instant testing of multi-user co-steering and terminal execution without forcing repo connection on first login.

---

### Pillar 5: Legal & Privacy Assurances

1. **Zero Data Retention Policy:**

- Ephemeral Firecracker sandboxes are destroyed upon session closure or 4-hour inactivity timeout. Uncommitted workspace code is never stored long-term on shared host disks.

2. **LLM Training Opt-Out:**

- Explicitly contract and route API calls through enterprise Zero Data Retention (ZDR) endpoints (e.g., Anthropic API / OpenAI API enterprise policies).
- Guarantee to users that private codebase data is **never used for base model training**.
