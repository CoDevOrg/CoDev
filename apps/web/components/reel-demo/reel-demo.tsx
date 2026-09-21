"use client";

import {
  AlertTriangle,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileCode2,
  GitMerge,
  Hash,
  Pause,
  Play,
  RotateCcw,
  Share2,
  Sparkles,
  TestTube2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./reel-demo.module.css";
import {
  adjacentScene,
  REEL_DURATION_MS,
  REEL_SCENES,
  sceneForElapsed,
  stableTimeForScene,
  typedPrefix,
  type ReelSceneName,
} from "./timeline";

type ReelDemoProps = {
  initialAutoplay: boolean;
  initialControls: boolean;
  initialLoop: boolean;
  initialScene: ReelSceneName;
};

const PEOPLE = [
  { name: "You", initials: "YO", color: "coral" },
  { name: "Maya Chen", initials: "MC", color: "violet" },
  { name: "Leo Park", initials: "LP", color: "green" },
] as const;

const SCENE_SUMMARY: Record<ReelSceneName, string> = {
  open: "A shared course-planner workspace opens with classmates and two agents.",
  share: "A co-steer invite is copied and Maya joins the running workspace.",
  presence: "The team can see each classmate's active file and current focus.",
  chat: "Classmates coordinate in a shared channel and mention the coding agent.",
  agents: "Codex and Claude work concurrently across isolated files.",
  conflict:
    "CoDev detects overlapping work and reassigns it before a merge conflict.",
  review:
    "The tests pass, Maya reviews the diff, and the branch merges into main.",
};

function useReducedMotion() {
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

function Avatar({
  initials,
  color,
  online = true,
}: {
  initials: string;
  color: string;
  online?: boolean;
}) {
  return (
    <span className={`${styles.avatar} ${styles[`avatar_${color}`]}`}>
      {initials}
      {online ? <i aria-hidden="true" /> : null}
    </span>
  );
}

export function ReelDemo({
  initialAutoplay,
  initialControls,
  initialLoop,
  initialScene,
}: ReelDemoProps) {
  const reducedMotion = useReducedMotion();
  const initialElapsed = stableTimeForScene(initialScene);
  const [elapsed, setElapsed] = useState(initialElapsed);
  const [playing, setPlaying] = useState(initialAutoplay);
  const elapsedRef = useRef(initialElapsed);
  const playingRef = useRef(initialAutoplay);
  const originRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  const setTimeline = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(next, REEL_DURATION_MS));
    elapsedRef.current = clamped;
    setElapsed(clamped);
    originRef.current = performance.now() - clamped;
  }, []);

  const setIsPlaying = useCallback((next: boolean) => {
    playingRef.current = next;
    setPlaying(next);
    if (next) originRef.current = performance.now() - elapsedRef.current;
  }, []);

  useEffect(() => {
    if (!reducedMotion) return;
    const settle = window.setTimeout(() => {
      setIsPlaying(false);
      setTimeline(stableTimeForScene(initialScene));
    }, 0);
    return () => window.clearTimeout(settle);
  }, [initialScene, reducedMotion, setIsPlaying, setTimeline]);

  useEffect(() => {
    if (!playing) return;

    const tick = (now: number) => {
      let next = now - originRef.current;
      if (next >= REEL_DURATION_MS) {
        if (initialLoop) {
          next %= REEL_DURATION_MS;
          originRef.current = now - next;
        } else {
          next = REEL_DURATION_MS;
          playingRef.current = false;
          setPlaying(false);
        }
      }
      elapsedRef.current = next;
      setElapsed(next);
      if (playingRef.current) frameRef.current = requestAnimationFrame(tick);
    };

    originRef.current = performance.now() - elapsedRef.current;
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [initialLoop, playing]);

  const activeScene = sceneForElapsed(elapsed);

  const jumpToScene = useCallback(
    (scene: ReelSceneName) => {
      setIsPlaying(false);
      setTimeline(stableTimeForScene(scene));
    },
    [setIsPlaying, setTimeline],
  );

  const replay = useCallback(() => {
    setTimeline(0);
    setIsPlaying(!reducedMotion);
  }, [reducedMotion, setIsPlaying, setTimeline]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement &&
        !(event.target.type === "range" && event.code === "Space")
      ) {
        return;
      }
      if (
        event.target instanceof HTMLButtonElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setIsPlaying(!playingRef.current);
      } else if (event.key.toLowerCase() === "r") {
        replay();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        jumpToScene(
          adjacentScene(activeScene.name, event.key === "ArrowLeft" ? -1 : 1)
            .name,
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeScene.name, jumpToScene, replay, setIsPlaying]);

  const state = {
    shareOpen: elapsed >= 3_450 && elapsed < 6_750,
    inviteCopied: elapsed >= 5_150,
    mayaJoined: elapsed >= 6_250,
    firstMessage: elapsed >= 7_650,
    secondMessage: elapsed >= 9_700,
    agentMentioned: elapsed >= 10_650,
    agentsWorking: elapsed >= 12_300,
    agentTests: elapsed >= 15_100,
    conflictOpen: elapsed >= 18_350 && elapsed < 22_650,
    conflictResolved: elapsed >= 21_050,
    reviewOpen: elapsed >= 23_250,
    testsPassed: elapsed >= 24_600,
    merged: elapsed >= 26_250,
  };
  const codexEdit = "!hasTimeConflict(section, occupied)";
  const claudeActivity = "Writing calendar conflict tests";
  const codexActivity = "Adding schedule conflict guard";
  const codexTyped = state.agentsWorking
    ? typedPrefix(codexEdit, elapsed, 12_300, 15_050)
    : codexEdit;
  const codexStatus = state.agentTests
    ? typedPrefix("Running conflict tests", elapsed, 15_100, 17_800)
    : typedPrefix(codexActivity, elapsed, 12_300, 14_850);
  const claudeStatus = state.agentsWorking
    ? typedPrefix(claudeActivity, elapsed, 12_850, 17_450)
    : "Reviewing calendar.tsx";
  const codexIsTyping = elapsed >= 12_300 && elapsed < 17_800;
  const claudeIsTyping = elapsed >= 12_850 && elapsed < 17_800;

  return (
    <main className={styles.page}>
      <section
        aria-label="Synthetic CoDev collaboration demo"
        className={styles.reel}
        data-scene={activeScene.name}
      >
        <div className={styles.ambient} aria-hidden="true" />
        <div className={styles.camera}>
          <div className={styles.workspace}>
            <header className={styles.topbar}>
              <span className={styles.brandBlock}>
                <span className={styles.brand}>CoDev</span>
                <small className={styles.demoBadge}>synthetic demo</small>
              </span>
              <span className={styles.repo}>
                <strong>team-signal/course-planner</strong>
                <code>main</code>
              </span>
              <span className={styles.liveStatus}>
                <i aria-hidden="true" /> 2 agents live
              </span>
              <button
                aria-label="Share workspace"
                className={styles.shareButton}
                type="button"
                tabIndex={-1}
              >
                <Share2 aria-hidden="true" size={15} /> Share
              </button>
            </header>

            <section className={styles.peopleBar} aria-label="Workspace team">
              <div className={styles.peopleTitle}>
                <Users aria-hidden="true" size={17} />
                <span>
                  <strong>Class project</strong>
                  <small>
                    {state.mayaJoined ? "3 here now" : "2 here now"}
                  </small>
                </span>
              </div>
              <div className={styles.peopleStack}>
                {PEOPLE.map((person, index) =>
                  index === 1 && !state.mayaJoined ? null : (
                    <Avatar
                      color={person.color}
                      initials={person.initials}
                      key={person.name}
                    />
                  ),
                )}
              </div>
              <div className={styles.focusSummary}>
                <span>
                  <i className={styles.coralDot} /> You · schedule.ts
                </span>
                <span>
                  <i className={styles.greenDot} /> Leo · tests
                </span>
                {state.mayaJoined ? (
                  <span className={styles.joinedLine}>
                    <i className={styles.violetDot} /> Maya joined · reviewing
                  </span>
                ) : null}
              </div>
            </section>

            <section className={styles.editor} aria-label="Shared code editor">
              <div className={styles.editorTabs}>
                <span className={styles.activeTab}>
                  <FileCode2 aria-hidden="true" size={13} /> schedule.ts
                </span>
                <span>conflicts.test.ts</span>
                <span>calendar.tsx</span>
              </div>
              <div className={styles.breadcrumb}>
                src / planner / <strong>schedule.ts</strong>
                <span>
                  {state.agentsWorking ? "Codex editing" : "You editing"}
                </span>
              </div>
              <pre className={styles.code} aria-label="Course scheduling code">
                <code>
                  <span>
                    <i>18</i>
                    <b>export function</b> findOpenSections(courses) &#123;
                  </span>
                  <span>
                    <i>19</i> <b>const</b> occupied = buildSchedule(courses);
                    {state.agentsWorking ? (
                      <em
                        aria-hidden="true"
                        className={`${styles.liveCaret} ${styles.mayaCaret}`}
                      >
                        Maya
                      </em>
                    ) : null}
                  </span>
                  <span className={state.agentsWorking ? styles.agentLine : ""}>
                    <i>20</i> <b>return</b> sections.filter((section) =&gt;
                  </span>
                  <span className={state.agentsWorking ? styles.agentLine : ""}>
                    <i>21</i> {codexTyped}
                    {codexIsTyping ? (
                      <em
                        aria-hidden="true"
                        className={`${styles.liveCaret} ${styles.codexCaret}`}
                      >
                        Codex
                      </em>
                    ) : null}
                  </span>
                  <span>
                    <i>22</i> );
                  </span>
                  <span>
                    <i>23</i>&#125;
                  </span>
                  <span>
                    <i>24</i>
                  </span>
                  <span className={state.agentTests ? styles.testLine : ""}>
                    <i>25</i>
                    <b>export const</b> MAX_CREDITS = 18;
                  </span>
                </code>
              </pre>
            </section>

            <div className={styles.lowerDeck}>
              <section className={styles.teamChat} aria-label="Team channel">
                <header>
                  <span>
                    <Hash aria-hidden="true" size={14} /> final-project
                  </span>
                  <small>Everyone + agents</small>
                </header>
                <div className={styles.messages}>
                  <article>
                    <Avatar color="green" initials="LP" />
                    <p>
                      <strong>Leo</strong>
                      <span>I’ll cover the conflict tests.</span>
                    </p>
                  </article>
                  {state.firstMessage ? (
                    <article className={styles.messageIn}>
                      <Avatar color="violet" initials="MC" />
                      <p>
                        <strong>Maya</strong>
                        <span>Joining now — I’ll review the planner UI.</span>
                      </p>
                    </article>
                  ) : null}
                  {state.secondMessage ? (
                    <article className={styles.messageIn}>
                      <Avatar color="coral" initials="YO" />
                      <p>
                        <strong>You</strong>
                        <span>
                          <mark>@agent</mark> wire the schedule conflict check.
                        </span>
                      </p>
                    </article>
                  ) : null}
                  {state.agentMentioned ? (
                    <article
                      className={`${styles.messageIn} ${styles.agentReply}`}
                    >
                      <span className={styles.botAvatar}>
                        <Sparkles size={14} />
                      </span>
                      <p>
                        <strong>Codex</strong>
                        <span>On it. Claiming schedule.ts.</span>
                      </p>
                    </article>
                  ) : null}
                </div>
              </section>

              <section className={styles.agents} aria-label="Live agents">
                <header>
                  <Bot aria-hidden="true" size={15} /> Live agents{" "}
                  <span>2</span>
                </header>
                <article
                  className={state.agentsWorking ? styles.agentActive : ""}
                >
                  <span className={styles.botAvatar}>
                    <Sparkles size={14} />
                  </span>
                  <div>
                    <strong>
                      Codex <small>started by you</small>
                    </strong>
                    <p className={codexIsTyping ? styles.typingStatus : ""}>
                      {codexStatus}
                      {codexIsTyping ? (
                        <span
                          className={styles.statusCaret}
                          aria-hidden="true"
                        />
                      ) : null}
                    </p>
                    <i>
                      <b
                        style={{
                          transform: `scaleX(${state.agentTests ? 0.84 : 0.58})`,
                        }}
                      />
                    </i>
                  </div>
                </article>
                <article
                  className={state.agentsWorking ? styles.agentActive : ""}
                >
                  <span
                    className={`${styles.botAvatar} ${styles.claudeAvatar}`}
                  >
                    C
                  </span>
                  <div>
                    <strong>
                      Claude <small>started by Maya</small>
                    </strong>
                    <p className={claudeIsTyping ? styles.typingStatus : ""}>
                      {claudeStatus}
                      {claudeIsTyping ? (
                        <span
                          className={`${styles.statusCaret} ${styles.claudeStatusCaret}`}
                          aria-hidden="true"
                        />
                      ) : null}
                    </p>
                    <i>
                      <b
                        style={{
                          transform: `scaleX(${state.agentTests ? 0.72 : 0.44})`,
                        }}
                      />
                    </i>
                  </div>
                </article>
              </section>
            </div>

            {state.shareOpen ? (
              <div className={styles.sheetBackdrop}>
                <section
                  aria-label="Share workspace dialog"
                  aria-modal="true"
                  className={styles.shareSheet}
                  role="dialog"
                >
                  <header>
                    <div>
                      <h2>Share workspace</h2>
                      <p>Bring a classmate into the running project.</p>
                    </div>
                    <X aria-hidden="true" size={19} />
                  </header>
                  <div className={styles.rolePicker}>
                    <span>
                      <Users aria-hidden="true" size={17} /> Anyone with the
                      link
                    </span>
                    <strong>Co-steer</strong>
                  </div>
                  <div className={styles.inviteLink}>
                    <code>codev.dev/join/course-planner</code>
                    <span className={state.inviteCopied ? styles.copied : ""}>
                      {state.inviteCopied ? (
                        <Check size={15} />
                      ) : (
                        <Copy size={15} />
                      )}
                      {state.inviteCopied ? "Copied" : "Copy"}
                    </span>
                  </div>
                  <div className={styles.accessRow}>
                    <Avatar color="coral" initials="YO" />
                    <span>
                      <strong>You</strong>
                      <small>Owner</small>
                    </span>
                  </div>
                  {state.mayaJoined ? (
                    <div
                      className={`${styles.accessRow} ${styles.accessJoined}`}
                    >
                      <Avatar color="violet" initials="MC" />
                      <span>
                        <strong>Maya Chen</strong>
                        <small>Co-steer · joined now</small>
                      </span>
                      <Check aria-hidden="true" size={17} />
                    </div>
                  ) : null}
                </section>
              </div>
            ) : null}

            {state.conflictOpen ? (
              <section
                className={styles.conflictPanel}
                aria-label="Write claim coordination"
              >
                <header>
                  {state.conflictResolved ? (
                    <Check size={20} />
                  ) : (
                    <AlertTriangle size={20} />
                  )}
                  <div>
                    <h2>
                      {state.conflictResolved
                        ? "Overlap resolved"
                        : "Overlapping work detected"}
                    </h2>
                    <p>No silent overwrite. CoDev caught it before merge.</p>
                  </div>
                </header>
                <div className={styles.claims}>
                  <span>
                    <b className={styles.codexMark}>CX</b>
                    <strong>Codex</strong>
                    <code>schedule.ts</code>
                    <em>claimed</em>
                  </span>
                  <span
                    className={state.conflictResolved ? styles.reassigned : ""}
                  >
                    <b className={styles.claudeMark}>CL</b>
                    <strong>Claude</strong>
                    <code>
                      {state.conflictResolved ? "calendar.tsx" : "schedule.ts"}
                    </code>
                    <em>{state.conflictResolved ? "reassigned" : "blocked"}</em>
                  </span>
                </div>
              </section>
            ) : null}

            {state.reviewOpen ? (
              <section
                className={styles.reviewPanel}
                aria-label="Review and merge"
              >
                <header>
                  <span>
                    <GitMerge aria-hidden="true" size={18} /> Review changes
                  </span>
                  <code>agent/schedule-conflicts</code>
                </header>
                <div className={styles.diffSummary}>
                  <strong>3 files changed</strong>
                  <span className={styles.additions}>+126</span>
                  <span className={styles.deletions}>−18</span>
                </div>
                <div className={styles.checkRow}>
                  <span className={state.testsPassed ? styles.checkPassed : ""}>
                    {state.testsPassed ? (
                      <Check size={16} />
                    ) : (
                      <TestTube2 size={16} />
                    )}
                    <strong>
                      {state.testsPassed
                        ? "42 tests passed"
                        : "Running test suite…"}
                    </strong>
                  </span>
                  <span>Reviewed by Maya</span>
                </div>
                <div className={styles.mergeAction}>
                  <button
                    className={state.merged ? styles.merged : ""}
                    type="button"
                    tabIndex={-1}
                  >
                    {state.merged ? (
                      <Check size={17} />
                    ) : (
                      <GitMerge size={17} />
                    )}
                    {state.merged ? "Merged into main" : "Approve and merge"}
                  </button>
                  {state.merged ? (
                    <small>Everyone has the final version.</small>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        </div>

        <div className={styles.timeline} aria-hidden="true">
          <i style={{ width: `${(elapsed / REEL_DURATION_MS) * 100}%` }} />
        </div>
        <p aria-live="polite" className={styles.srOnly}>
          {SCENE_SUMMARY[activeScene.name]}
        </p>
      </section>

      {initialControls || reducedMotion ? (
        <nav aria-label="Reel playback" className={styles.controls}>
          <button
            aria-label="Previous scene"
            onClick={() =>
              jumpToScene(adjacentScene(activeScene.name, -1).name)
            }
            title="Previous scene (Left arrow)"
            type="button"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            aria-label={playing ? "Pause reel" : "Play reel"}
            onClick={() => setIsPlaying(!playing)}
            title={playing ? "Pause reel (Space)" : "Play reel (Space)"}
            type="button"
          >
            {playing ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
          </button>
          <button
            aria-label="Replay reel"
            onClick={replay}
            title="Replay reel (R)"
            type="button"
          >
            <RotateCcw aria-hidden="true" />
          </button>
          <button
            aria-label="Next scene"
            onClick={() => jumpToScene(adjacentScene(activeScene.name, 1).name)}
            title="Next scene (Right arrow)"
            type="button"
          >
            <ChevronRight aria-hidden="true" />
          </button>
          <label className={styles.scrubber}>
            <span className={styles.srOnly}>Scrub reel timeline</span>
            <input
              aria-label="Scrub reel timeline"
              max={REEL_DURATION_MS}
              min={0}
              onChange={(event) => {
                setIsPlaying(false);
                setTimeline(Number(event.currentTarget.value));
              }}
              step={50}
              type="range"
              value={Math.round(elapsed)}
            />
          </label>
          <select
            aria-label="Demo scene"
            onChange={(event) =>
              jumpToScene(event.target.value as ReelSceneName)
            }
            value={activeScene.name}
          >
            {REEL_SCENES.map((scene) => (
              <option key={scene.name} value={scene.name}>
                {scene.label}
              </option>
            ))}
          </select>
          <output>{(elapsed / 1000).toFixed(1)}s / 28.0s</output>
        </nav>
      ) : null}
    </main>
  );
}
