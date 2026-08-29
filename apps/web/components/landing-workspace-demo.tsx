"use client";

import { Check, Pause, Play, RotateCcw, Share2, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/** Pointer that walks the viewer through the invite steps in the Join phase. */
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
  /** Each agent runs in its own isolated worktree on its own branch. */
  branch: string;
  /** The one file this agent touches. No two agents share a file. */
  file: string;
  /** ms it starts editing its own file. */
  editsFrom: number;
  /** ms it finishes and moves to review. */
  editsTo: number;
};

const DEMO_DURATION = 17_600;

/**
 * Beats inside the Join phase that walk through the real invite flow: the
 * owner opens Share, a single-use link is created and copied, and the invited
 * teammate lands straight in the running workspace. Mirrors
 * WorkspaceShareDialog and the /invites/[token] accept step.
 */
const INVITE = {
  /** Cursor reaches Share and clicks; the dialog opens. */
  shareOpensAt: 850,
  /** Cursor clicks Copy on the link row. */
  copyAt: 2_150,
  /** Cursor clicks Send on the invite row. */
  sendAt: 3_150,
  /** The invited teammate lands in the room. */
  guestJoinsAt: 3_600,
  /** Dialog closes, cursor leaves. */
  shareClosesAt: 4_550,
  role: "Co-steer",
  link: "codev.dev/w/acme-storefront/j/7f3a91",
  invitee: "casey@rivera.dev",
} as const;

type Teammate = {
  id: string;
  name: string;
  initials: string;
  tone: AgentTone;
  detail: string;
  /** ms into the timeline this person is first in the room (0 = from the start). */
  joinsAt: number;
};

const TEAMMATES: Teammate[] = [
  {
    id: "alex",
    name: "Alex Morgan",
    initials: "AM",
    tone: "orange",
    detail: "Opened the workspace",
    joinsAt: 0,
  },
  {
    id: "jordan",
    name: "Jordan Lee",
    initials: "JL",
    tone: "green",
    detail: "Connected acme/storefront",
    joinsAt: 0,
  },
  {
    id: "casey",
    name: "Casey Rivera",
    initials: "CR",
    tone: "purple",
    detail: "Joined from the invite",
    joinsAt: INVITE.guestJoinsAt,
  },
];

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
      "Copy one invite link, pick a role, and your crew is in the running workspace.",
  },
  {
    key: "write",
    label: "Write",
    endpoint: 12_950,
    summary:
      "Each agent gets its own branch. The workspace brain keeps them off the same files.",
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
    summary: "The merged change is tested and ready for a person to review.",
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
    branch: "agent/checkout-race",
    file: "src/checkout/reserve.ts",
    editsFrom: 5_050,
    editsTo: 11_400,
  },
  {
    id: "claude",
    name: "Claude",
    model: "Anthropic",
    initials: "CL",
    tone: "green",
    task: "Make reservations idempotent",
    branch: "agent/idempotency",
    file: "src/checkout/session.ts",
    editsFrom: 8_600,
    editsTo: 12_400,
  },
  {
    id: "review",
    name: "Review",
    model: "CoDev",
    initials: "RV",
    tone: "purple",
    task: "Guard retries, then review",
    branch: "agent/retry-guard",
    file: "src/lib/retry.ts",
    editsFrom: 6_400,
    editsTo: 12_600,
  },
];

/** The one branch whose file is shown in the editor pane (Codex's worktree). */
const EDITOR_AGENT = {
  name: "Codex",
  tone: "orange" as AgentTone,
  branch: "agent/checkout-race",
  segments: [
    {
      line: 7,
      start: 5_050,
      text: "  const cart = checkoutSchema.parse(input);",
    },
    {
      line: 8,
      start: 6_500,
      text: "  const lock = await claim(`checkout:${cart.id}`);",
    },
    { line: 9, start: 7_800, text: "  if (!lock) return retryLater(cart);" },
    {
      line: 11,
      start: 9_100,
      text: "  const order = await commit(cart, lock);",
    },
    {
      line: 12,
      start: 10_200,
      text: '  await audit.record("checkout.reserved", order.id);',
    },
    { line: 13, start: 11_300, text: "  return order;" },
  ] as TypingSegment[],
};

/** Workspace-brain events shown during Write: agents routed off each other. */
const COORD_EVENTS: { at: number; text: string }[] = [
  { at: 5_200, text: "Codex claimed src/checkout/reserve.ts" },
  { at: 7_600, text: "Claude reached for reserve.ts, already Codex's" },
  { at: 8_900, text: "Claude rerouted to src/checkout/session.ts" },
  { at: 10_900, text: "3 branches, 0 overlapping files" },
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
  const segment = EDITOR_AGENT.segments.find((s) => s.line === line);
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
  EDITOR_AGENT.segments.map(
    (segment) => [segment.line, typingCheckpoints(segment.text)] as const,
  ),
);

function visibleCharacterCount(segment: TypingSegment, elapsed: number) {
  const localElapsed = elapsed - segment.start;
  if (localElapsed <= 0) return 0;
  const checkpoints = SEGMENT_TIMINGS.get(segment.line) ?? [];
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
  if (elapsed >= PHASES[2]!.endpoint) return "Ready";
  if (elapsed >= agent.editsTo || elapsed >= PHASES[1]!.endpoint)
    return "Reviewing";
  if (elapsed >= agent.editsFrom) return "Editing";
  return "Joining";
}

export function LandingWorkspaceDemo() {
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLSpanElement>(null);
  const copyRef = useRef<HTMLElement>(null);
  const sendRef = useRef<HTMLElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef(0);
  const startedRef = useRef(false);
  const [elapsed, setElapsed] = useState(0);
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
      new Map(EDITOR_AGENT.segments.map((segment) => [segment.line, segment])),
    [],
  );

  const joining = phase === "join";
  const sharePanelOpen =
    renderedElapsed >= INVITE.shareOpensAt &&
    renderedElapsed < INVITE.shareClosesAt;
  const linkCopied = renderedElapsed >= INVITE.copyAt;
  const inviteSent = renderedElapsed >= INVITE.sendAt;
  const roster = TEAMMATES.filter((mate) => renderedElapsed >= mate.joinsAt);
  const coordEvents = COORD_EVENTS.filter((ev) => renderedElapsed >= ev.at);

  // Guide cursor: which target it is heading for, whether it is shown, and
  // whether it is mid-tap. It leads each action by ~600ms so it has landed by
  // the time the button reacts.
  const cursorTarget: "share" | "copy" | "send" | "exit" =
    renderedElapsed < INVITE.copyAt - 600
      ? "share"
      : renderedElapsed < INVITE.sendAt - 600
        ? "copy"
        : renderedElapsed < INVITE.shareClosesAt - 250
          ? "send"
          : "exit";
  const showCursor =
    !reducedMotion &&
    joining &&
    renderedElapsed >= 250 &&
    renderedElapsed < INVITE.shareClosesAt + 200;
  const cursorTapping = [
    INVITE.shareOpensAt,
    INVITE.copyAt,
    INVITE.sendAt,
  ].some((at) => renderedElapsed >= at && renderedElapsed < at + 220);

  useEffect(() => {
    if (!showCursor) return;
    const workspace = workspaceRef.current;
    const cursor = cursorRef.current;
    if (!workspace || !cursor) return;
    const frame = window.requestAnimationFrame(() => {
      const wsRect = workspace.getBoundingClientRect();
      let x = wsRect.width * 0.17;
      let y = wsRect.height * 0.82;
      const anchor =
        cursorTarget === "share"
          ? shareRef.current
          : cursorTarget === "copy"
            ? copyRef.current
            : cursorTarget === "send"
              ? sendRef.current
              : null;
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        x = rect.left - wsRect.left + rect.width / 2;
        y = rect.top - wsRect.top + rect.height / 2;
      }
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
    // Join is a choreographed sequence (open Share -> create link -> copy ->
    // the teammate lands in the room), so replay it from the top rather than
    // snapping to the end of the phase like the deterministic later phases.
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
            <i aria-hidden="true" />{" "}
            {joining ? "Inviting the crew" : "3 agents live"}
          </span>
          <span
            className="lp-workspace-people"
            aria-label={`${roster.length} people in the workspace`}
          >
            {roster.map((mate) => (
              <i key={mate.id}>{mate.initials}</i>
            ))}
          </span>
          <span
            ref={shareRef}
            className={`lp-workspace-share${sharePanelOpen ? " is-open" : ""}`}
          >
            <Share2 aria-hidden size={13} /> Share
          </span>
        </header>

        {sharePanelOpen ? (
          <div
            className="lp-invite-overlay"
            role="note"
            aria-label="Share workspace"
          >
            <div className="lp-invite-pop">
              <b className="lp-invite-title">Share workspace</b>
              <i className="lp-invite-sub">
                Anyone with the link joins at the role you pick. Links are
                single-use and expire in 24h.
              </i>
              <i className="lp-invite-role">
                <em>Role</em>
                {INVITE.role}
              </i>
              <i className={`lp-invite-line${linkCopied ? " is-done" : ""}`}>
                <code>{INVITE.link}</code>
                <em ref={copyRef}>{linkCopied ? "Copied" : "Copy"}</em>
              </i>
              <i className={`lp-invite-line${inviteSent ? " is-done" : ""}`}>
                <code>{INVITE.invitee}</code>
                <em ref={sendRef}>{inviteSent ? "Sent" : "Send"}</em>
              </i>
              <i className="lp-invite-status">
                {inviteSent
                  ? "Sent. Casey opened the link."
                  : linkCopied
                    ? "Link copied."
                    : " "}
              </i>
            </div>
          </div>
        ) : null}

        {showCursor ? (
          <div
            ref={cursorRef}
            className={`lp-demo-cursor${cursorTapping ? " is-tapping" : ""}${
              cursorTarget === "exit" ? " is-leaving" : ""
            }`}
            aria-hidden="true"
          >
            <GuideCursor />
          </div>
        ) : null}

        <div className="lp-workspace-body">
          <aside className="lp-team-rail" aria-label="Workspace team">
            <div className="lp-rail-heading">
              <span>Team room</span>
              <strong>
                <Users aria-hidden size={13} /> {roster.length} online
              </strong>
            </div>
            {roster.map((mate) => {
              const fresh =
                mate.joinsAt > 0 && renderedElapsed < mate.joinsAt + 1_500;
              return (
                <div
                  key={mate.id}
                  className={`lp-team-person${
                    mate.id === "alex" ? " is-active" : ""
                  }${fresh ? " is-joining" : ""}`}
                >
                  <i className={`lp-person-${mate.tone}`}>{mate.initials}</i>
                  <span>
                    <strong>{mate.name}</strong>
                    <small>{mate.detail}</small>
                  </span>
                  {fresh ? <em className="lp-join-tag">joined</em> : null}
                </div>
              );
            })}
            <div className="lp-team-note">
              <span>Shared context</span>
              <p>Everyone sees every branch, cursor, and agent, live.</p>
            </div>
          </aside>

          <section className="lp-editor" aria-label="Code editor">
            <header className="lp-editor-tabs">
              <span className="is-open">
                <i aria-hidden="true">TS</i> reserve.ts
              </span>
              <span>session.ts</span>
              <span className="lp-editor-branch">
                <i aria-hidden="true" /> agent/checkout-race
              </span>
            </header>
            <div className="lp-editor-breadcrumb">
              src <b>›</b> checkout <b>›</b> reserve.ts
            </div>
            <pre
              className={`lp-code${phase === "write" ? " has-coord" : ""}`}
              aria-hidden="true"
            >
              <code>
                {Array.from({ length: 14 }, (_, index) => {
                  const line = index + 1;
                  const segment = lineSegments.get(line);
                  if (!segment) {
                    return (
                      <span className="lp-code-row" key={line}>
                        <i>{line}</i>
                        <span>{STATIC_LINES.get(line) || " "}</span>
                      </span>
                    );
                  }

                  const count = visibleCharacterCount(segment, renderedElapsed);
                  const text = segment.text.slice(0, count);
                  const hasStarted = renderedElapsed >= segment.start;
                  const complete = count >= segment.text.length;
                  const laterSegmentStarted = EDITOR_AGENT.segments.some(
                    (later) =>
                      later.start > segment.start &&
                      renderedElapsed >= later.start,
                  );
                  const showEditorCursor = hasStarted && !laterSegmentStarted;

                  return (
                    <span
                      className={`lp-code-row lp-code-${EDITOR_AGENT.tone}${hasStarted ? " is-authored" : ""}`}
                      key={line}
                    >
                      <i>{line}</i>
                      <span>
                        {text || " "}
                        {showEditorCursor ? (
                          <b
                            className={`lp-agent-cursor${complete ? " is-settled" : " is-typing"}`}
                          >
                            <em>{EDITOR_AGENT.name}</em>
                          </b>
                        ) : null}
                      </span>
                    </span>
                  );
                })}
              </code>
            </pre>
            <pre className="lp-sr-only" aria-label="Completed file">
              {FINAL_CODE}
            </pre>
            {phase === "write" ? (
              <div className="lp-coord-log" aria-label="Workspace brain">
                <header>
                  <i className="lp-brain-mark" aria-hidden="true">
                    {"◈"}
                  </i>
                  Workspace brain
                </header>
                <ul>
                  {coordEvents.map((ev) => (
                    <li key={ev.at}>{ev.text}</li>
                  ))}
                </ul>
              </div>
            ) : null}
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
                    <code>{agent.branch}</code>
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
                <small>3 branches merged, 42 tests passed</small>
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
