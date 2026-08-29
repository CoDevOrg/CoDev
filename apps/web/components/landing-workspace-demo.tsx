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
  /** Cursor clicks Done after the link is copied. */
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
      "Three agents, three branches. They hand off through the workspace brain, never the same file.",
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
    tone: "purple",
    task: "Validate checkout input",
    branch: "agent/checkout-race",
    editsFrom: 4_750,
    editsTo: 11_200,
  },
  {
    id: "claude",
    name: "Claude",
    model: "Anthropic",
    initials: "CL",
    tone: "orange",
    task: "Make reservations idempotent",
    branch: "agent/idempotency",
    editsFrom: 5_000,
    editsTo: 12_100,
  },
  {
    id: "review",
    name: "Review",
    model: "CoDev",
    initials: "RV",
    tone: "green",
    task: "Guard retries, then review",
    branch: "agent/retry-guard",
    editsFrom: 5_250,
    editsTo: 12_950,
  },
];

type EditorFile = {
  id: string;
  tab: string;
  branch: string;
  path: string;
  lines: number;
  agent: { name: string; tone: AgentTone };
  /** Skeleton lines that are there before anyone types. */
  base: [number, string][];
  /** Lines this file's agent types in, with per-line start times. */
  segments: TypingSegment[];
  /** [start, end] ms the editor shows this tab. */
  focus: [number, number];
};

/** One tab per agent. The editor follows whichever agent is writing. */
const FILES: EditorFile[] = [
  {
    id: "reserve",
    tab: "reserve.ts",
    branch: "agent/checkout-race",
    path: "src/checkout/reserve.ts",
    lines: 13,
    agent: { name: "Codex", tone: "purple" },
    base: [
      [1, 'import { audit } from "@/lib/audit";'],
      [2, 'import { checkoutSchema } from "@/lib/checkout";'],
      [3, 'import { claim, commit } from "@/lib/reservations";'],
      [4, ""],
      [5, "export const reserveSchema = checkoutSchema;"],
      [6, ""],
      [7, "export async function reserve(input: unknown) {"],
      [11, ""],
      [13, "}"],
    ],
    segments: [
      {
        line: 8,
        start: 5_100,
        text: "  const cart = reserveSchema.parse(input);",
      },
      {
        line: 9,
        start: 6_200,
        text: "  const lock = await claim(`checkout:${cart.id}`);",
      },
      {
        line: 10,
        start: 7_200,
        text: "  const order = await commit(cart, lock);",
      },
      {
        line: 12,
        start: 7_900,
        text: '  audit.record("checkout.reserved", order.id);',
      },
    ],
    focus: [4_750, 8_400],
  },
  {
    id: "session",
    tab: "session.ts",
    branch: "agent/idempotency",
    path: "src/checkout/session.ts",
    lines: 12,
    agent: { name: "Claude", tone: "orange" },
    base: [
      [1, 'import { redis } from "@/lib/redis";'],
      [2, 'import { reserveSchema } from "./reserve";'],
      [3, ""],
      [4, "export async function sessionFor(cartId: string) {"],
      [5, "  const key = `sess:${cartId}`;"],
      [8, ""],
      [11, "  return session;"],
      [12, "}"],
    ],
    segments: [
      { line: 6, start: 8_500, text: "  const held = await redis.get(key);" },
      { line: 7, start: 9_200, text: "  if (held) return JSON.parse(held);" },
      {
        line: 9,
        start: 9_800,
        text: "  const session = reserveSchema.session(cartId);",
      },
      {
        line: 10,
        start: 10_300,
        text: "  await redis.set(key, session, { ex: 900 });",
      },
    ],
    focus: [8_400, 10_800],
  },
  {
    id: "retry",
    tab: "retry.ts",
    branch: "agent/retry-guard",
    path: "src/lib/retry.ts",
    lines: 9,
    agent: { name: "Review", tone: "green" },
    base: [
      [1, "type Task<T> = () => Promise<T>;"],
      [2, ""],
      [3, "export async function retryLater<T>(task: Task<T>, tries = 3) {"],
      [7, "  }"],
      [8, '  throw new Error("checkout: retries exhausted");'],
      [9, "}"],
    ],
    segments: [
      { line: 4, start: 10_850, text: "  for (let i = 0; i < tries; i++) {" },
      { line: 5, start: 11_450, text: "    try { return await task(); }" },
      {
        line: 6,
        start: 12_050,
        text: "    catch (err) { return backoff(i, err); }",
      },
    ],
    focus: [10_800, 12_950],
  },
];

/** Workspace-brain events shown during Write: claims, hand-offs, no conflicts. */
const COORD_EVENTS: { at: number; text: string }[] = [
  { at: 5_200, text: "Codex claimed reserve.ts" },
  { at: 7_600, text: "Claude is waiting on reserveSchema from Codex" },
  { at: 8_500, text: "Codex pushed it, Claude picked up session.ts" },
  { at: 11_200, text: "Review diffing all 3 branches, 0 file conflicts" },
];

function finalCodeFor(file: EditorFile) {
  const seg = new Map(file.segments.map((s) => [s.line, s.text]));
  const base = new Map(file.base);
  return Array.from(
    { length: file.lines },
    (_, index) => seg.get(index + 1) ?? base.get(index + 1) ?? "",
  ).join("\n");
}

const RESERVE_FINAL = finalCodeFor(FILES[0]!);

function characterDelay(character: string, index: number) {
  if (character === " ") return 24;
  if (/[(){}[\],.;:`]/.test(character)) return 82;
  return 39 + ((character.charCodeAt(0) + index * 7) % 23);
}

function typingCheckpoints(text: string, maxDuration: number) {
  let total = 0;
  const checkpoints = Array.from(text, (character, index) => {
    total += characterDelay(character, index);
    return total;
  });
  const scale = total > maxDuration ? maxDuration / total : 1;
  return checkpoints.map((checkpoint) => Math.round(checkpoint * scale));
}

const SEGMENT_TIMINGS = new Map(
  FILES.flatMap((file) =>
    file.segments.map((segment, index) => {
      const nextStart = file.segments[index + 1]?.start ?? file.focus[1];
      // Leave a short settled beat before the cursor moves to the next line or
      // agent. This keeps every agent legible even when its code is longer.
      const availableDuration = Math.max(160, nextStart - segment.start - 140);
      return [
        `${file.id}-${segment.line}`,
        typingCheckpoints(segment.text, availableDuration),
      ] as const;
    }),
  ),
);

export function activeFileForElapsed(elapsed: number) {
  return (
    FILES.find((file) => elapsed >= file.focus[0] && elapsed < file.focus[1]) ??
    FILES[0]!
  );
}

export function activeAgentsForElapsed(elapsed: number) {
  return AGENTS.filter(
    (agent) => elapsed >= agent.editsFrom && elapsed < agent.editsTo,
  );
}

function visibleCharacterCount(
  fileId: string,
  segment: TypingSegment,
  elapsed: number,
) {
  const localElapsed = elapsed - segment.start;
  if (localElapsed <= 0) return 0;
  const checkpoints = SEGMENT_TIMINGS.get(`${fileId}-${segment.line}`) ?? [];
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
  if (elapsed >= agent.editsFrom) return "Typing";
  if (elapsed >= PHASES[0]!.endpoint) return "Queued";
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
  const sendRef = useRef<HTMLSpanElement>(null);
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

  const activeFile = activeFileForElapsed(renderedElapsed);
  const activeAgents = activeAgentsForElapsed(renderedElapsed);
  const activeLineSegments = useMemo(
    () =>
      new Map(activeFile.segments.map((segment) => [segment.line, segment])),
    [activeFile],
  );
  const activeBase = useMemo(() => new Map(activeFile.base), [activeFile]);

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
            className="lp-share-overlay"
            role="note"
            aria-label="Share acme storefront workspace"
          >
            <section className="lp-share-panel">
              <header className="lp-share-heading">
                <h3>Share &apos;acme/storefront&apos;</h3>
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
                  className={inviteSent ? "is-done" : undefined}
                  ref={sendRef}
                >
                  Done
                </span>
              </footer>
            </section>
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
            <header className="lp-editor-tabs lp-editor-tabs-multi">
              {FILES.map((file) => (
                <span
                  key={file.id}
                  className={file.id === activeFile.id ? "is-open" : undefined}
                >
                  <i
                    className={`lp-tab-dot lp-dot-${file.agent.tone}`}
                    aria-hidden="true"
                  />
                  {file.tab}
                </span>
              ))}
            </header>
            <div className="lp-editor-breadcrumb">
              <span className="lp-editor-path">
                {activeFile.branch} <b>›</b> {activeFile.path}
              </span>
              {phase === "write" && activeAgents.length > 0 ? (
                <span
                  className="lp-active-typists"
                  aria-label={`${activeAgents.map((agent) => agent.name).join(", ")} typing simultaneously`}
                >
                  {activeAgents.map((agent) => (
                    <strong
                      key={agent.id}
                      className={`lp-active-typist lp-active-typist-${agent.tone}`}
                    >
                      <i aria-hidden="true" /> {agent.name}
                      <b aria-hidden="true" />
                    </strong>
                  ))}
                </span>
              ) : null}
            </div>
            <pre
              key={activeFile.id}
              className={`lp-code lp-code-swap${phase === "write" ? " has-coord" : ""}`}
              aria-hidden="true"
            >
              <code>
                {Array.from({ length: activeFile.lines }, (_, index) => {
                  const line = index + 1;
                  const segment = activeLineSegments.get(line);
                  if (!segment) {
                    return (
                      <span className="lp-code-row" key={line}>
                        <i>{line}</i>
                        <span>{activeBase.get(line) || " "}</span>
                      </span>
                    );
                  }

                  const count = visibleCharacterCount(
                    activeFile.id,
                    segment,
                    renderedElapsed,
                  );
                  const text = segment.text.slice(0, count);
                  const hasStarted = renderedElapsed >= segment.start;
                  const complete = count >= segment.text.length;
                  const laterSegmentStarted = activeFile.segments.some(
                    (later) =>
                      later.start > segment.start &&
                      renderedElapsed >= later.start,
                  );
                  const showEditorCursor = hasStarted && !laterSegmentStarted;

                  return (
                    <span
                      className={`lp-code-row lp-code-${activeFile.agent.tone}${hasStarted ? " is-authored" : ""}`}
                      key={line}
                    >
                      <i>{line}</i>
                      <span>
                        {text || " "}
                        {showEditorCursor ? (
                          <b
                            className={`lp-agent-cursor${complete ? " is-settled" : " is-typing"}`}
                          >
                            <em>{activeFile.agent.name}</em>
                          </b>
                        ) : null}
                      </span>
                    </span>
                  );
                })}
              </code>
            </pre>
            <pre className="lp-sr-only" aria-label="Completed file">
              {RESERVE_FINAL}
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
                    className={`lp-agent-card lp-agent-${agent.tone}${status === "Typing" ? " is-typing" : ""}`}
                    key={agent.id}
                  >
                    <div>
                      <i>{agent.initials}</i>
                      <span>
                        <strong>{agent.name}</strong>
                        <small>{agent.model}</small>
                      </span>
                      <b>
                        {status === "Typing" ? <i aria-hidden="true" /> : null}
                        {status}
                      </b>
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
