"use client";

import {
  Check,
  ChevronDown,
  HelpCircle,
  Link2,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Share2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

function GuideCursor() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3.5 2 15 8.4l-4.7 1.15L13 15.1l-2.1 1.05-2.7-5.55L4 14.7Z"
        fill="#f7f4ef"
        stroke="#0c0e10"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type DemoPhase = "join" | "write" | "verify" | "ready";
type AgentTone = "orange" | "green" | "purple";

type TypingSegment = {
  line: number;
  start: number;
  text: string;
};

type AgentTrack = {
  id: string;
  name: string;
  model: string;
  initials: string;
  tone: AgentTone;
  task: string;
  segments: TypingSegment[];
};

const DEMO_DURATION = 17_600;

const SHARE_DEMO = {
  opensAt: 850,
  copyAt: 2_150,
  doneAt: 3_250,
  closesAt: 4_550,
} as const;

const PHASES: {
  key: DemoPhase;
  label: string;
  endpoint: number;
  summary: string;
}[] = [
  {
    key: "join",
    label: "Join",
    endpoint: 4_750,
    summary:
      "Share one workspace link, choose its access, and bring the whole crew in.",
  },
  {
    key: "write",
    label: "Write",
    endpoint: 12_950,
    summary:
      "Codex, Claude, and Review edit separate regions of the file together.",
  },
  {
    key: "verify",
    label: "Verify",
    endpoint: 15_750,
    summary:
      "The agents run the checkout tests and review the combined change.",
  },
  {
    key: "ready",
    label: "Ready",
    endpoint: DEMO_DURATION,
    summary: "The shared file is tested and ready for a person to review.",
  },
];

const AGENTS: AgentTrack[] = [
  {
    id: "codex",
    name: "Codex",
    model: "OpenAI",
    initials: "CX",
    tone: "orange",
    task: "Validate checkout input",
    segments: [
      {
        line: 7,
        start: 5_050,
        text: "  const cart = checkoutSchema.parse(input);",
      },
      {
        line: 12,
        start: 9_850,
        text: '  await audit.record("checkout.reserved", order.id);',
      },
    ],
  },
  {
    id: "claude",
    name: "Claude",
    model: "Anthropic",
    initials: "CL",
    tone: "green",
    task: "Make reservations idempotent",
    segments: [
      {
        line: 8,
        start: 5_600,
        text: "  const lock = await claim(`checkout:${cart.id}`);",
      },
      {
        line: 11,
        start: 9_350,
        text: "  const order = await commit(cart, lock);",
      },
    ],
  },
  {
    id: "review",
    name: "Review",
    model: "CoDev",
    initials: "RV",
    tone: "purple",
    task: "Guard retries and review",
    segments: [
      {
        line: 9,
        start: 6_200,
        text: "  if (!lock) return retryLater(cart);",
      },
      { line: 13, start: 10_400, text: "  return order;" },
    ],
  },
];

const STATIC_LINES = new Map<number, string>([
  [1, 'import { audit } from "@/lib/audit";'],
  [2, 'import { checkoutSchema } from "@/lib/checkout";'],
  [3, 'import { claim, commit } from "@/lib/reservations";'],
  [4, ""],
  [5, "type CheckoutResult = Promise<Order | Retry>;"],
  [6, "export async function reserve(input: unknown): CheckoutResult {"],
  [10, ""],
  [14, "}"],
]);

const FINAL_CODE = Array.from({ length: 14 }, (_, index) => {
  const line = index + 1;
  const segment = AGENTS.flatMap((agent) => agent.segments).find(
    (candidate) => candidate.line === line,
  );
  return segment?.text ?? STATIC_LINES.get(line) ?? "";
}).join("\n");

function characterDelay(character: string, index: number) {
  if (character === " ") return 24;
  if (/[(){}[\],.;:`]/.test(character)) return 82;
  return 39 + ((character.charCodeAt(0) + index * 7) % 23);
}

function typingCheckpoints(text: string) {
  let total = 0;
  return Array.from(text, (character, index) => {
    total += characterDelay(character, index);
    return total;
  });
}

const SEGMENT_TIMINGS = new Map(
  AGENTS.flatMap((agent) =>
    agent.segments.map(
      (segment) =>
        [
          `${agent.id}-${segment.line}`,
          typingCheckpoints(segment.text),
        ] as const,
    ),
  ),
);

function visibleCharacterCount(
  agentId: string,
  segment: TypingSegment,
  elapsed: number,
) {
  const localElapsed = elapsed - segment.start;
  if (localElapsed <= 0) return 0;
  const checkpoints = SEGMENT_TIMINGS.get(`${agentId}-${segment.line}`) ?? [];
  let low = 0;
  let high = checkpoints.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((checkpoints[middle] ?? Infinity) <= localElapsed) low = middle + 1;
    else high = middle;
  }
  return low;
}

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

function phaseForElapsed(elapsed: number): DemoPhase {
  if (elapsed < PHASES[0]!.endpoint) return "join";
  if (elapsed < PHASES[1]!.endpoint) return "write";
  if (elapsed < PHASES[2]!.endpoint) return "verify";
  return "ready";
}

function statusForAgent(agent: AgentTrack, elapsed: number) {
  const counts = agent.segments.map((segment) =>
    visibleCharacterCount(agent.id, segment, elapsed),
  );
  const hasStarted = counts.some((count) => count > 0);
  const isTyping = agent.segments.some(
    (segment, index) =>
      counts[index]! > 0 && counts[index]! < segment.text.length,
  );
  const isComplete = agent.segments.every(
    (segment, index) => counts[index]! >= segment.text.length,
  );

  if (elapsed >= PHASES[2]!.endpoint) return "Ready";
  if (elapsed >= PHASES[1]!.endpoint || isComplete) return "Reviewing";
  if (isTyping || hasStarted) return "Editing";
  return "Joining";
}

export function LandingWorkspaceDemo({
  initialElapsed = 0,
}: {
  /** Allows deterministic inspection of a point in the choreographed demo. */
  initialElapsed?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLSpanElement>(null);
  const copyRef = useRef<HTMLSpanElement>(null);
  const doneRef = useRef<HTMLSpanElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef(initialElapsed);
  const startedRef = useRef(false);
  const [elapsed, setElapsed] = useState(initialElapsed);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    if (typeof window.IntersectionObserver !== "function") {
      const timer = window.setTimeout(() => {
        setInView(true);
        if (!reducedMotion && !startedRef.current) {
          startedRef.current = true;
          setPlaying(true);
        }
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting);
        setInView(visible);
        if (visible && !reducedMotion && !startedRef.current) {
          startedRef.current = true;
          setPlaying(true);
        }
      },
      { threshold: 0.28 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion]);

  useEffect(() => {
    const update = () =>
      setDocumentVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!playing || !inView || !documentVisible || reducedMotion) return;

    let frame = 0;
    let previous = performance.now();
    const step = (now: number) => {
      const next = Math.min(
        DEMO_DURATION,
        elapsedRef.current + Math.min(now - previous, 100),
      );
      previous = now;
      elapsedRef.current = next;
      setElapsed(next);
      if (next >= DEMO_DURATION) {
        setPlaying(false);
        return;
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [documentVisible, inView, playing, reducedMotion]);

  const renderedElapsed = reducedMotion ? DEMO_DURATION : elapsed;
  const isPlaying = playing && !reducedMotion;
  const phase = phaseForElapsed(renderedElapsed);
  const phaseDefinition =
    PHASES.find((item) => item.key === phase) ?? PHASES[0]!;
  const lineSegments = useMemo(
    () =>
      new Map(
        AGENTS.flatMap((agent) =>
          agent.segments.map((segment) => [segment.line, { agent, segment }]),
        ),
      ),
    [],
  );
  const isJoinPhase = phase === "join";
  const sharePanelOpen =
    renderedElapsed >= SHARE_DEMO.opensAt &&
    renderedElapsed < SHARE_DEMO.closesAt;
  const linkCopied = renderedElapsed >= SHARE_DEMO.copyAt;
  const shareComplete = renderedElapsed >= SHARE_DEMO.doneAt;
  const cursorTarget: "share" | "copy" | "done" | "exit" =
    renderedElapsed < SHARE_DEMO.copyAt - 600
      ? "share"
      : renderedElapsed < SHARE_DEMO.doneAt - 600
        ? "copy"
        : renderedElapsed < SHARE_DEMO.closesAt - 250
          ? "done"
          : "exit";
  const showCursor =
    !reducedMotion &&
    isJoinPhase &&
    renderedElapsed >= 250 &&
    renderedElapsed < SHARE_DEMO.closesAt + 200;
  const cursorTapping = [
    SHARE_DEMO.opensAt,
    SHARE_DEMO.copyAt,
    SHARE_DEMO.doneAt,
  ].some((at) => renderedElapsed >= at && renderedElapsed < at + 220);

  useEffect(() => {
    if (!showCursor) return;
    const workspace = workspaceRef.current;
    const cursor = cursorRef.current;
    if (!workspace || !cursor) return;
    const frame = window.requestAnimationFrame(() => {
      const workspaceBounds = workspace.getBoundingClientRect();
      const anchor =
        cursorTarget === "share"
          ? shareRef.current
          : cursorTarget === "copy"
            ? copyRef.current
            : cursorTarget === "done"
              ? doneRef.current
              : null;
      const x = anchor
        ? anchor.getBoundingClientRect().left -
          workspaceBounds.left +
          anchor.getBoundingClientRect().width / 2
        : workspaceBounds.width * 0.17;
      const y = anchor
        ? anchor.getBoundingClientRect().top -
          workspaceBounds.top +
          anchor.getBoundingClientRect().height / 2
        : workspaceBounds.height * 0.82;
      cursor.style.transform = `translate(${x}px, ${y}px)`;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cursorTarget, showCursor]);

  function setTimeline(next: number) {
    elapsedRef.current = next;
    setElapsed(next);
  }

  function choosePhase(nextPhase: DemoPhase) {
    const definition = PHASES.find((item) => item.key === nextPhase);
    if (!definition) return;
    startedRef.current = true;
    if (nextPhase === "join") {
      setTimeline(0);
      setPlaying(!reducedMotion);
      return;
    }
    setPlaying(false);
    setTimeline(
      definition.key === "ready"
        ? definition.endpoint
        : definition.endpoint - 1,
    );
  }

  function togglePlayback() {
    startedRef.current = true;
    if (elapsedRef.current >= DEMO_DURATION) setTimeline(0);
    setPlaying((current) => !current);
  }

  function replay() {
    startedRef.current = true;
    setTimeline(0);
    setPlaying(!reducedMotion);
  }

  return (
    <div className="lp-demo" ref={rootRef}>
      <div className="lp-demo-controls">
        <ol aria-label="Demo phases" className="lp-phase-list">
          {PHASES.map((item, index) => (
            <li key={item.key}>
              <button
                type="button"
                aria-current={item.key === phase ? "step" : undefined}
                className={item.key === phase ? "is-active" : undefined}
                onClick={() => choosePhase(item.key)}
              >
                <span aria-hidden="true">{index + 1}</span>
                {item.label}
              </button>
            </li>
          ))}
        </ol>
        <div className="lp-playback-controls">
          <button
            type="button"
            onClick={togglePlayback}
            aria-label={isPlaying ? "Pause demo" : "Play demo"}
            disabled={reducedMotion}
          >
            {isPlaying ? (
              <Pause aria-hidden size={14} />
            ) : (
              <Play aria-hidden size={14} />
            )}
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={replay} aria-label="Replay demo">
            <RotateCcw aria-hidden size={14} />
            Replay
          </button>
        </div>
      </div>

      <div className="lp-workspace" data-phase={phase} ref={workspaceRef}>
        <header className="lp-workspace-topbar">
          <span className="lp-workspace-mark" aria-hidden="true">
            C
          </span>
          <span className="lp-workspace-repo">
            <strong>acme/storefront</strong>
            <code>main</code>
          </span>
          <span className="lp-workspace-live">
            <i aria-hidden="true" /> 3 agents live
          </span>
          <span
            className="lp-workspace-people"
            aria-label="Three people present"
          >
            <i>AM</i>
            <i>JL</i>
            <i>CR</i>
          </span>
          <span
            className={`lp-workspace-share${sharePanelOpen ? " is-open" : ""}`}
            ref={shareRef}
          >
            <Share2 aria-hidden size={13} /> Share
          </span>
        </header>

        {sharePanelOpen ? (
          <div
            className="lp-share-overlay"
            role="note"
            aria-label="Share acme storefront workspace"
          >
            <section className="lp-share-panel">
              <header className="lp-share-heading">
                <h3>Share ‘acme/storefront’</h3>
                <span aria-hidden="true">
                  <HelpCircle size={16} />
                  <Settings size={16} />
                </span>
              </header>
              <div className="lp-share-add">Add people, groups, or teams</div>
              <div className="lp-share-section">
                <h4>People with access</h4>
                <div className="lp-share-person">
                  <i>AM</i>
                  <span>
                    <strong>Alex Morgan (you)</strong>
                    <small>alex@acme.dev</small>
                  </span>
                  <em>Owner</em>
                </div>
              </div>
              <div className="lp-share-section lp-share-general">
                <h4>General access</h4>
                <div className="lp-share-restricted">
                  <i>
                    <LockKeyhole size={15} />
                  </i>
                  <span>
                    <strong>
                      Restricted <ChevronDown size={12} />
                    </strong>
                    <small>
                      Only people with access can open with the link
                    </small>
                  </span>
                </div>
              </div>
              <footer className="lp-share-actions">
                <span
                  className={linkCopied ? "is-copied" : undefined}
                  ref={copyRef}
                >
                  {linkCopied ? <Check size={14} /> : <Link2 size={14} />}
                  {linkCopied ? "Link copied" : "Copy link"}
                </span>
                <span
                  className={shareComplete ? "is-done" : undefined}
                  ref={doneRef}
                >
                  Done
                </span>
              </footer>
            </section>
          </div>
        ) : null}

        {showCursor ? (
          <div
            aria-hidden="true"
            className={`lp-demo-cursor${cursorTapping ? " is-tapping" : ""}${
              cursorTarget === "exit" ? " is-leaving" : ""
            }`}
            ref={cursorRef}
          >
            <GuideCursor />
          </div>
        ) : null}

        <div className="lp-workspace-body">
          <aside className="lp-team-rail" aria-label="Workspace team">
            <div className="lp-rail-heading">
              <span>Team room</span>
              <strong>
                <Users aria-hidden size={13} /> 3 online
              </strong>
            </div>
            <div className="lp-team-person is-active">
              <i className="lp-person-orange">AM</i>
              <span>
                <strong>Alex Morgan</strong>
                <small>Watching reserve.ts</small>
              </span>
            </div>
            <div className="lp-team-person">
              <i className="lp-person-green">JL</i>
              <span>
                <strong>Jordan Lee</strong>
                <small>Steering Claude</small>
              </span>
            </div>
            <div className="lp-team-person">
              <i className="lp-person-purple">CR</i>
              <span>
                <strong>Casey Rivera</strong>
                <small>Reviewing changes</small>
              </span>
            </div>
            <div className="lp-team-note">
              <span>Shared context</span>
              <p>Everyone sees the same file, cursors, and agent state.</p>
            </div>
          </aside>

          <section className="lp-editor" aria-label="Shared code editor">
            <header className="lp-editor-tabs">
              <span className="is-open">
                <i aria-hidden="true">TS</i> reserve.ts
              </span>
              <span>checkout.test.ts</span>
              <b aria-label="Three agents editing this file">
                <i className="lp-agent-dot lp-dot-orange" />
                <i className="lp-agent-dot lp-dot-green" />
                <i className="lp-agent-dot lp-dot-purple" />
              </b>
            </header>
            <div className="lp-editor-breadcrumb">
              src <b>›</b> checkout <b>›</b> reserve.ts
            </div>
            <pre className="lp-code" aria-hidden="true">
              <code>
                {Array.from({ length: 14 }, (_, index) => {
                  const line = index + 1;
                  const authored = lineSegments.get(line);
                  if (!authored) {
                    return (
                      <span className="lp-code-row" key={line}>
                        <i>{line}</i>
                        <span>{STATIC_LINES.get(line) || " "}</span>
                      </span>
                    );
                  }

                  const count = visibleCharacterCount(
                    authored.agent.id,
                    authored.segment,
                    renderedElapsed,
                  );
                  const text = authored.segment.text.slice(0, count);
                  const hasStarted = renderedElapsed >= authored.segment.start;
                  const complete = count >= authored.segment.text.length;
                  const laterSegmentStarted = authored.agent.segments.some(
                    (segment) =>
                      segment.start > authored.segment.start &&
                      renderedElapsed >= segment.start,
                  );
                  const showCursor = hasStarted && !laterSegmentStarted;

                  return (
                    <span
                      className={`lp-code-row lp-code-${authored.agent.tone}${hasStarted ? " is-authored" : ""}`}
                      key={line}
                    >
                      <i>{line}</i>
                      <span>
                        {text || " "}
                        {showCursor ? (
                          <b
                            className={`lp-agent-cursor${complete ? " is-settled" : " is-typing"}`}
                          >
                            <em>{authored.agent.name}</em>
                          </b>
                        ) : null}
                      </span>
                    </span>
                  );
                })}
              </code>
            </pre>
            <pre className="lp-sr-only" aria-label="Completed shared file">
              {FINAL_CODE}
            </pre>
            <div
              className={`lp-terminal${renderedElapsed >= PHASES[1]!.endpoint ? " is-visible" : ""}`}
            >
              <header>
                <span>TERMINAL</span>
                <code>pnpm test checkout</code>
              </header>
              <p>
                <Check aria-hidden size={12} /> checkout/reserve.test.ts{" "}
                <strong>42 passed</strong>
                <small>1.8s</small>
              </p>
            </div>
          </section>

          <aside className="lp-agent-panel" aria-label="Live agents">
            <div className="lp-agent-panel-heading">
              <span>
                <i /> Live agents
              </span>
              <strong>3/3</strong>
            </div>
            <ul>
              {AGENTS.map((agent) => {
                const status = statusForAgent(agent, renderedElapsed);
                return (
                  <li
                    className={`lp-agent-card lp-agent-${agent.tone}`}
                    key={agent.id}
                  >
                    <div>
                      <i>{agent.initials}</i>
                      <span>
                        <strong>{agent.name}</strong>
                        <small>{agent.model}</small>
                      </span>
                      <b>{status}</b>
                    </div>
                    <p>{agent.task}</p>
                    <code>src/checkout/reserve.ts</code>
                  </li>
                );
              })}
            </ul>
            <div
              className={`lp-review-ready${phase === "ready" ? " is-visible" : ""}`}
            >
              <Check aria-hidden size={14} />
              <span>
                <strong>Ready for review</strong>
                <small>1 file · 42 tests passed</small>
              </span>
            </div>
          </aside>
        </div>
      </div>

      <div className="lp-demo-status" aria-live="polite" id="lp-demo-status">
        <span>{phaseDefinition.label}</span>
        <p>{phaseDefinition.summary}</p>
      </div>
    </div>
  );
}
