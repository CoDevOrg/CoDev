"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The landing page's centrepiece: a running miniature of a CoDev workspace.
 * It is a scripted simulation, not live data — the real workspace lives behind
 * sign-in — so everything here is deterministic on first render and only starts
 * moving in an effect, which keeps server and client markup identical.
 */

type SceneKey = "live" | "coordinate" | "merge" | "share";

const SCENES: {
  key: SceneKey;
  tab: string;
  title: string;
  copy: string;
}[] = [
  {
    key: "live",
    tab: "Live activity",
    title: "See what every agent is doing, right now.",
    copy: "No more staring at a spinner in someone else's chat. Every command, file, and test streams into the room as it happens.",
  },
  {
    key: "coordinate",
    tab: "Coordination",
    title: "Agents know what the other agents are touching.",
    copy: "Before an agent edits a file it claims the path. Overlaps get caught up front and the second agent is rerouted instead of colliding.",
  },
  {
    key: "merge",
    tab: "Clean merges",
    title: "Separate worktrees. One clean merge.",
    copy: "Everyone works in isolation, but the room shares one picture of the truth — so the branches come back together without a conflict pile-up.",
  },
  {
    key: "share",
    tab: "Sharing",
    title: "Share it like a doc.",
    copy: "Send one link. They land in the same repo, the same runtime, the same agent history — already caught up.",
  },
];

const AGENTS = [
  {
    id: "nova",
    initials: "NV",
    name: "Nova",
    model: "Opus",
    tone: "lime",
    worktree: "agent/checkout-race",
    steps: [
      "Reading src/checkout/reserve.ts",
      "Tracing reservation → payment",
      "Writing a failing test",
      "Making reservation idempotent",
      "42 tests passed",
    ],
  },
  {
    id: "atlas",
    initials: "AT",
    name: "Atlas",
    model: "Codex",
    tone: "orange",
    worktree: "agent/webhook-retries",
    steps: [
      "Reading src/webhooks/stripe.ts",
      "Adding backoff to the retry queue",
      "Replaying 1,204 stored events",
      "18 tests passed",
      "Ready for review",
    ],
  },
  {
    id: "iris",
    initials: "IR",
    name: "Iris",
    model: "Review",
    tone: "sky",
    worktree: "agent/review",
    steps: [
      "Watching both worktrees",
      "Diffing 12 changed files",
      "Flagged a missing rollback",
      "Nova picked up the note",
      "Clear to merge",
    ],
  },
] as const;

const CLAIM_LOG = [
  { tone: "lime", text: "Nova claimed src/checkout/**" },
  { tone: "orange", text: "Atlas planned an edit to src/checkout/reserve.ts" },
  { tone: "warn", text: "Overlap detected — same file, two worktrees" },
  { tone: "orange", text: "Atlas rerouted to src/webhooks/**" },
  { tone: "ok", text: "0 conflicts · both agents still running" },
] as const;

const CLAIM_FILES = [
  { path: "src/checkout/reserve.ts", owner: "Nova", tone: "lime" },
  { path: "src/checkout/session.ts", owner: "Nova", tone: "lime" },
  { path: "src/webhooks/stripe.ts", owner: "Atlas", tone: "orange" },
  { path: "src/webhooks/queue.ts", owner: "Atlas", tone: "orange" },
  { path: "src/lib/money.ts", owner: "Open", tone: "idle" },
] as const;

const BRANCHES = [
  { name: "agent/checkout-race", tone: "lime", files: 7 },
  { name: "agent/webhook-retries", tone: "orange", files: 4 },
  { name: "yousef/copy-tweaks", tone: "sky", files: 1 },
] as const;

const GUESTS = [
  { initials: "AK", name: "Alex", tone: "orange" },
  { initials: "MR", name: "Maya", tone: "sky" },
  { initials: "JD", name: "Jonas", tone: "lime" },
] as const;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function LandingWorkspaceDemo() {
  const reducedMotion = usePrefersReducedMotion();
  const [scene, setScene] = useState<SceneKey>("live");
  const [tick, setTick] = useState(0);
  // Auto-play is a demo, not a carousel the reader has to fight. The first
  // deliberate tab click hands control over for good.
  const [autoPlay, setAutoPlay] = useState(true);
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1_500);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  useEffect(() => {
    if (!autoPlay || reducedMotion) return;
    const timer = window.setInterval(() => {
      setScene((current) => {
        const index = SCENES.findIndex((item) => item.key === current);
        return SCENES[(index + 1) % SCENES.length]!.key;
      });
    }, 9_000);
    return () => window.clearInterval(timer);
  }, [autoPlay, reducedMotion]);

  const active = useMemo(
    () => SCENES.find((item) => item.key === scene) ?? SCENES[0]!,
    [scene],
  );

  function selectScene(key: SceneKey) {
    setAutoPlay(false);
    setScene(key);
  }

  return (
    <div className="lp-demo" ref={region}>
      <div className="lp-demo-tabs" role="tablist" aria-label="Workspace tour">
        {SCENES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`lp-tab-${item.key}`}
            aria-selected={item.key === scene}
            aria-controls="lp-demo-panel"
            className={item.key === scene ? "is-active" : undefined}
            onClick={() => selectScene(item.key)}
          >
            {item.tab}
            {item.key === scene && autoPlay && !reducedMotion ? (
              <i className="lp-tab-progress" aria-hidden="true" />
            ) : null}
          </button>
        ))}
      </div>

      <div
        className="lp-window"
        id="lp-demo-panel"
        role="tabpanel"
        aria-labelledby={`lp-tab-${scene}`}
      >
        <div className="lp-window-bar">
          <span className="lp-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="lp-repo">
            <b>friends</b>/side-project
            <em>main</em>
          </span>
          <span className="lp-presence" aria-label="4 people in this workspace">
            <i className="lp-avatar lp-tone-lime">YM</i>
            <i className="lp-avatar lp-tone-orange">AK</i>
            <i className="lp-avatar lp-tone-sky">MR</i>
            <b>+1</b>
          </span>
        </div>

        <div className="lp-window-body" data-scene={scene}>
          {scene === "live" ? <LiveScene tick={tick} /> : null}
          {scene === "coordinate" ? <CoordinateScene tick={tick} /> : null}
          {scene === "merge" ? <MergeScene tick={tick} /> : null}
          {scene === "share" ? <ShareScene tick={tick} /> : null}
        </div>
      </div>

      <div className="lp-demo-caption" aria-live="polite">
        <h3>{active.title}</h3>
        <p>{active.copy}</p>
      </div>
    </div>
  );
}

function LiveScene({ tick }: { tick: number }) {
  return (
    <div className="lp-scene lp-scene-live">
      <div className="lp-scene-head">
        <span className="lp-live-pill">
          <i />3 agents running
        </span>
        <span className="lp-scene-meta">Everyone sees this same feed</span>
      </div>
      <div className="lp-agent-list">
        {AGENTS.map((agent, index) => {
          const step = (tick + index * 2) % agent.steps.length;
          const line = agent.steps[step]!;
          const done = step === agent.steps.length - 1;
          return (
            <article className="lp-agent" key={agent.id}>
              <span className={`lp-avatar lp-tone-${agent.tone}`}>
                {agent.initials}
              </span>
              <div className="lp-agent-main">
                <header>
                  <strong>{agent.name}</strong>
                  <span className="lp-chip">{agent.model}</span>
                  <code>{agent.worktree}</code>
                </header>
                <p
                  key={`${agent.id}-${step}`}
                  className="lp-typing"
                  style={{ "--chars": line.length } as React.CSSProperties}
                >
                  {line}
                </p>
                <div className="lp-bar" aria-hidden="true">
                  <i
                    style={{
                      width: `${((step + 1) / agent.steps.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <span className={done ? "lp-state is-done" : "lp-state"}>
                {done ? "Done" : "Working"}
              </span>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function CoordinateScene({ tick }: { tick: number }) {
  const revealed = (tick % (CLAIM_LOG.length + 2)) + 1;
  return (
    <div className="lp-scene lp-scene-coordinate">
      <div className="lp-claims">
        <p className="lp-scene-label">Path claims</p>
        {CLAIM_FILES.map((file) => (
          <div className={`lp-claim lp-tone-${file.tone}`} key={file.path}>
            <code>{file.path}</code>
            <span>{file.owner}</span>
          </div>
        ))}
      </div>
      <div className="lp-log">
        <p className="lp-scene-label">Coordination log</p>
        <ul>
          {CLAIM_LOG.slice(0, Math.min(revealed, CLAIM_LOG.length)).map(
            (entry) => (
              <li className={`lp-log-${entry.tone}`} key={entry.text}>
                <i aria-hidden="true" />
                {entry.text}
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}

function MergeScene({ tick }: { tick: number }) {
  const merged = tick % 6 >= 3;
  return (
    <div className="lp-scene lp-scene-merge">
      <div className="lp-merge-graph" aria-hidden="true">
        <svg viewBox="0 0 320 200" preserveAspectRatio="none">
          {BRANCHES.map((branch, index) => (
            <path
              key={branch.name}
              className={`lp-merge-path lp-stroke-${branch.tone}${merged ? " is-merged" : ""}`}
              d={`M8 ${34 + index * 66} H150 Q206 ${34 + index * 66} 206 100 H312`}
            />
          ))}
        </svg>
      </div>
      <div className="lp-merge-branches">
        {BRANCHES.map((branch) => (
          <div className={`lp-merge-branch lp-tone-${branch.tone}`} key={branch.name}>
            <code>{branch.name}</code>
            <small>{branch.files} files</small>
          </div>
        ))}
      </div>
      <div className={merged ? "lp-merge-target is-merged" : "lp-merge-target"}>
        <strong>main</strong>
        <span>{merged ? "✓ merged · 0 conflicts" : "waiting on review"}</span>
      </div>
    </div>
  );
}

function ShareScene({ tick }: { tick: number }) {
  const joined = Math.min(tick % (GUESTS.length + 3), GUESTS.length);
  return (
    <div className="lp-scene lp-scene-share">
      <div className="lp-share-card">
        <p className="lp-scene-label">Share this workspace</p>
        <div className="lp-share-link">
          <code>codev.dev/w/side-project</code>
          <button type="button" tabIndex={-1} aria-hidden="true">
            Copy link
          </button>
        </div>
        <p className="lp-share-note">
          Anyone with the link joins the running workspace — repo, terminal,
          agents, and history included.
        </p>
        <div className="lp-share-people">
          {GUESTS.map((guest, index) => (
            <span
              key={guest.name}
              className={
                index < joined
                  ? `lp-share-person is-in lp-tone-${guest.tone}`
                  : `lp-share-person lp-tone-${guest.tone}`
              }
            >
              <i className={`lp-avatar lp-tone-${guest.tone}`}>
                {guest.initials}
              </i>
              {guest.name}
              <b>{index < joined ? "joined" : "invited"}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="lp-share-editor" aria-hidden="true">
        <pre>
          <code>
            {`export async function reserve(cart: Cart) {
  const lock = await claim(cart.id);
  if (!lock) return retryLater(cart);
  return commit(cart, lock);
}`}
          </code>
        </pre>
        {GUESTS.slice(0, joined).map((guest, index) => (
          <span
            key={guest.name}
            className={`lp-cursor lp-tone-${guest.tone} lp-cursor-${index + 1}`}
          >
            {guest.name}
          </span>
        ))}
      </div>
    </div>
  );
}
