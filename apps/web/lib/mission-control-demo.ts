import {
  type AgentLogLine,
  type AgentPhase,
  type MissionControlAgent,
  type MissionControlSnapshot,
} from "@/lib/mission-control-model";

/**
 * A scripted-but-live workspace for demonstrating Mission Control.
 *
 * Real agents only exist while a runtime host is up and real subscriptions are
 * burning tokens, which makes the multi-human story impossible to show on
 * demand. This drives the same `MissionControlSnapshot` the live workspace
 * produces, so the surface under it is the real one — only the source differs.
 */

const MEMBERS = [
  { id: "m-alex", name: "Alex Morgan", initials: "AM", hue: 24 },
  { id: "m-jordan", name: "Jordan Lee", initials: "JL", hue: 152 },
  { id: "m-casey", name: "Casey Rivera", initials: "CR", hue: 268 },
];

let sequence = 0;
function nextId(prefix: string) {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function line(
  kind: AgentLogLine["kind"],
  text: string,
  at: number,
  authorId?: string,
): AgentLogLine {
  return {
    id: nextId("log"),
    at,
    kind,
    text,
    ...(authorId ? { authorId } : {}),
  };
}

/** Per-agent scripts: the believable next thing each one would say. */
const SCRIPTS: Record<string, string[]> = {
  "a-auth": [
    "Reading src/auth/session.ts",
    "Rewriting refresh-token rotation",
    "Extracting expiry math into a helper",
    "Adding a regression test for expired refresh",
    "Running pnpm test --filter auth",
    "3 tests passing, 1 failing on clock skew",
    "Widening the skew tolerance to 30s",
    "Re-running the auth suite",
  ],
  "a-billing": [
    "Tracing the Stripe webhook handler",
    "Found two handlers writing the same row",
    "Making invoice.paid idempotent",
    "Adding an idempotency key column",
    "Writing the migration",
    "Backfilling existing invoice rows",
    "Verifying against the replayed webhook fixture",
  ],
  "a-perf": [
    "Profiling the workspace list query",
    "N+1 on workspace_members confirmed",
    "Rewriting as a single joined select",
    "Query time 840ms to 42ms locally",
    "Checking the index covers the new predicate",
    "Adding a covering index migration",
  ],
  "a-ui": [
    "Reading components/repository-picker.tsx",
    "Keyboard focus escapes the listbox",
    "Adding roving tabindex",
    "Wiring aria-activedescendant",
    "Testing with VoiceOver semantics",
    "Focus trap holds through the whole list",
  ],
  "a-docs": [
    "Scanning docs/OPERATIONS.md for drift",
    "Idle timeout still documented as 30m",
    "Updating to the current 10m behaviour",
    "Cross-checking against runtime.yaml",
  ],
};

const PHASE_CYCLE: AgentPhase[] = [
  "planning",
  "editing",
  "testing",
  "reviewing",
];

function agent(
  input: Omit<MissionControlAgent, "log" | "tokens"> & {
    seedLog: string[];
    seedTokens: number;
  },
  now: number,
): MissionControlAgent {
  return {
    ...input,
    // Deterministic so the server and client first paint agree — the numbers
    // start moving on the first tick, which only ever runs in the browser.
    tokens: input.seedTokens,
    log: input.seedLog.map((text, index) =>
      line("action", text, now - (input.seedLog.length - index) * 9_000),
    ),
  };
}

export function createDemoSnapshot(now = Date.now()): MissionControlSnapshot {
  return {
    workspace: "checkout-hardening",
    repository: "acme/storefront",
    members: MEMBERS,
    maxAgents: 5,
    agents: [
      agent(
        {
          id: "a-auth",
          title: "Fix refresh-token rotation dropping sessions",
          branch: "agent/auth-refresh-rotation",
          provider: "claude",
          model: "Claude Opus 5",
          phase: "testing",
          activity: "Running pnpm test --filter auth",
          ownerId: "m-alex",
          watcherIds: ["m-jordan"],
          startedAt: now - 8 * 60_000,
          files: [
            {
              path: "src/auth/session.ts",
              added: 64,
              removed: 21,
              claimed: true,
            },
            {
              path: "src/auth/refresh.test.ts",
              added: 88,
              removed: 0,
              claimed: true,
            },
          ],
          plan: [
            { label: "Reproduce the dropped session", state: "done" },
            { label: "Rotate without invalidating in-flight", state: "done" },
            { label: "Cover expiry + clock skew", state: "active" },
            { label: "Open for review", state: "pending" },
          ],
          seedTokens: 18400,
          seedLog: [
            "Reproduced with a 40s clock skew",
            "Rotation now issues before invalidating",
            "Added refresh.test.ts",
          ],
        },
        now,
      ),
      agent(
        {
          id: "a-billing",
          title: "Make invoice webhooks idempotent",
          branch: "agent/billing-idempotency",
          provider: "codex",
          model: "GPT-5.6 Terra",
          phase: "editing",
          activity: "Writing the idempotency-key migration",
          ownerId: "m-jordan",
          watcherIds: [],
          startedAt: now - 14 * 60_000,
          files: [
            {
              path: "src/billing/webhooks.ts",
              added: 112,
              removed: 47,
              claimed: true,
            },
            {
              path: "drizzle/0042_invoice_idempotency.sql",
              added: 18,
              removed: 0,
              claimed: true,
            },
          ],
          plan: [
            { label: "Find the duplicate write", state: "done" },
            { label: "Add an idempotency key", state: "active" },
            { label: "Backfill existing rows", state: "pending" },
            { label: "Replay the webhook fixture", state: "pending" },
          ],
          seedTokens: 26900,
          seedLog: [
            "Two handlers wrote the same invoice row",
            "invoice.paid is the duplicate path",
          ],
        },
        now,
      ),
      agent(
        {
          id: "a-perf",
          title: "Kill the N+1 on the workspace list",
          branch: "agent/perf-workspace-list",
          provider: "claude",
          model: "Claude Sonnet 5",
          phase: "reviewing",
          activity: "840ms to 42ms — checking index coverage",
          ownerId: "m-alex",
          watcherIds: ["m-casey"],
          startedAt: now - 21 * 60_000,
          files: [
            {
              path: "src/lib/workspaces.ts",
              added: 41,
              removed: 68,
              claimed: true,
            },
          ],
          plan: [
            { label: "Profile the endpoint", state: "done" },
            { label: "Collapse into one query", state: "done" },
            { label: "Add a covering index", state: "active" },
          ],
          seedTokens: 31250,
          seedLog: [
            "Confirmed N+1 on workspace_members",
            "Rewrote as a single joined select",
            "Local p95 down to 42ms",
          ],
        },
        now,
      ),
      agent(
        {
          id: "a-ui",
          title: "Repository picker traps keyboard focus",
          branch: "agent/a11y-repo-picker",
          provider: "codex",
          model: "GPT-5.6 Luna",
          phase: "blocked",
          activity: "Waiting on a write claim held by another agent",
          ownerId: "m-casey",
          watcherIds: [],
          startedAt: now - 4 * 60_000,
          blockedBy: { agentId: "a-perf", path: "src/lib/workspaces.ts" },
          files: [
            {
              path: "components/repository-picker.tsx",
              added: 37,
              removed: 12,
              claimed: true,
            },
          ],
          plan: [
            { label: "Reproduce the focus escape", state: "done" },
            { label: "Add roving tabindex", state: "active" },
            { label: "Verify with a screen reader", state: "pending" },
          ],
          seedTokens: 9700,
          seedLog: [
            "Focus escapes the listbox on ArrowDown",
            "Needs src/lib/workspaces.ts — claim held",
          ],
        },
        now,
      ),
      agent(
        {
          id: "a-docs",
          title: "Operations doc still says 30m idle timeout",
          branch: "agent/docs-idle-timeout",
          provider: "claude",
          model: "Claude Haiku 4.5",
          phase: "done",
          activity: "Ready to merge — 1 file, +6 −4",
          ownerId: "m-jordan",
          watcherIds: [],
          startedAt: now - 31 * 60_000,
          files: [
            {
              path: "docs/OPERATIONS.md",
              added: 6,
              removed: 4,
              claimed: false,
            },
          ],
          plan: [
            { label: "Find the stale claim", state: "done" },
            { label: "Match the runtime config", state: "done" },
            { label: "Open for review", state: "done" },
          ],
          seedTokens: 12050,
          seedLog: [
            "Idle timeout documented as 30m",
            "runtime.yaml says 10m",
            "Updated and cross-checked",
          ],
        },
        now,
      ),
    ],
  };
}

/**
 * Advance the world one tick. Pure: returns a new snapshot, so React state
 * updates stay predictable and the caller controls cadence.
 */
export function advanceDemo(
  snapshot: MissionControlSnapshot,
  now = Date.now(),
): MissionControlSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((current) => {
      if (current.phase === "done" || current.phase === "waiting") {
        return current;
      }
      const script = SCRIPTS[current.id] ?? [];
      // Advance roughly every third tick so lines are readable, not a blur.
      if (script.length === 0 || Math.random() > 0.34) {
        return {
          ...current,
          tokens: current.tokens + 40 + Math.floor(Math.random() * 260),
        };
      }
      const used = current.log.filter(
        (entry) => entry.kind === "action",
      ).length;
      const next = script[used % script.length] ?? current.activity;
      const grew = current.phase === "editing" || current.phase === "blocked";
      return {
        ...current,
        activity: next,
        tokens: current.tokens + 120 + Math.floor(Math.random() * 400),
        phase:
          current.phase === "blocked"
            ? "blocked"
            : (PHASE_CYCLE[
                (PHASE_CYCLE.indexOf(current.phase) +
                  (Math.random() > 0.8 ? 1 : 0)) %
                  PHASE_CYCLE.length
              ] ?? current.phase),
        files: grew
          ? current.files.map((file, index) =>
              index === 0
                ? { ...file, added: file.added + Math.floor(Math.random() * 4) }
                : file,
            )
          : current.files,
        log: [...current.log, line("action", next, now)].slice(-40),
      };
    }),
  };
}

/** Apply a human steer, exactly as the live surface would render one. */
export function steerDemo(
  snapshot: MissionControlSnapshot,
  agentId: string,
  authorId: string,
  text: string,
  now = Date.now(),
): MissionControlSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((current) =>
      current.id === agentId
        ? {
            ...current,
            activity: `Steering: ${text}`,
            phase: "planning",
            watcherIds: current.watcherIds.includes(authorId)
              ? current.watcherIds
              : [...current.watcherIds, authorId],
            log: [...current.log, line("steer", text, now, authorId)].slice(
              -40,
            ),
          }
        : current,
    ),
  };
}

export function interruptDemo(
  snapshot: MissionControlSnapshot,
  agentId: string,
  authorId: string,
  now = Date.now(),
): MissionControlSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((current) =>
      current.id === agentId
        ? {
            ...current,
            phase: "waiting",
            activity: "Paused — waiting for your instruction",
            log: [
              ...current.log,
              line("warn", "Interrupted by a collaborator", now, authorId),
            ].slice(-40),
          }
        : current,
    ),
  };
}
