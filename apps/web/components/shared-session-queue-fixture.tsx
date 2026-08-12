"use client";

import { useState } from "react";

import {
  enqueueSharedSessionTurn,
  sharedSessionSchema,
} from "@codev/contracts";

import styles from "@/app/verification/b0-2/fixture.module.css";

const fixtureSession = sharedSessionSchema.parse({
  sessionId: "f3100000-0000-4000-8000-000000000001",
  workspaceId: "b0200000-0000-4000-8000-000000000001",
  ownerId: "b0200000-0000-4000-8000-000000000011",
  worktreeId: "f3100000-0000-4000-8000-000000000002",
  provider: "Codex-compatible",
  model: "gpt-5",
  state: "idle",
  activeTurnId: null,
  streamCursor: 0,
  queue: [],
});

const fixtureTranscript = [
  {
    position: 1,
    author: "Alex Morgan",
    prompt: "Inspect the repository layout.",
    tool: "read_file · README.md",
    output: "Repository structure is ready for the shared session.",
  },
  {
    position: 2,
    author: "Jordan Lee",
    prompt: "Summarize the collaboration plan.",
    tool: "list_files · src/",
    output: "The session keeps one ordered transcript for every collaborator.",
  },
] as const;

const fixtureCompletedAction = {
  tool: "read_file · README.md",
  output: "Repository structure is ready for the shared session.",
} as const;

type ControlledTurnState = "idle" | "running" | "interrupted";

const fixtureMembers = {
  alex: {
    id: "b0200000-0000-4000-8000-000000000011",
    name: "Alex Morgan",
    role: "Maintainer",
  },
  jordan: {
    id: "b0200000-0000-4000-8000-000000000012",
    name: "Jordan Lee",
    role: "Collaborator",
  },
  casey: {
    id: "b0200000-0000-4000-8000-000000000013",
    name: "Casey Rivera",
    role: "Viewer",
  },
} as const;

export function SharedSessionQueueFixture() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasTranscript, setHasTranscript] = useState(false);
  const [queue, setQueue] = useState(fixtureSession.queue);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [controlledTurnState, setControlledTurnState] =
    useState<ControlledTurnState>("idle");
  const [interruptedBy, setInterruptedBy] = useState<string | null>(null);
  const queuedInstruction = queue[0];

  function startControlledTurn() {
    if (controlledTurnState !== "idle") return;
    setControlledTurnState("running");
  }

  function interruptControlledTurn() {
    if (controlledTurnState !== "running") return;
    setInterruptedBy(fixtureMembers.jordan.name);
    setControlledTurnState("interrupted");
  }

  function queueJordanInstruction() {
    const prompt = draftPrompt.trim();
    if (!prompt || queue.length > 0) return;

    const result = enqueueSharedSessionTurn(queue, {
      id: "f3100000-0000-4000-8000-000000000003",
      sessionId: fixtureSession.sessionId,
      authorId: fixtureMembers.jordan.id,
      prompt,
      enqueuedAt: "2026-07-30T12:02:00.000Z",
    });
    setQueue(result.queue);
    setDraftPrompt("");
  }

  return (
    <section
      className={`${styles.card} ${styles.sharedSession}`}
      aria-labelledby="shared-session-heading"
    >
      <div className={styles.cardHeading}>
        <div>
          <span className={styles.kicker}>F3.1 · durable shared session</span>
          <h2 id="shared-session-heading">Shared session queue</h2>
        </div>
        <span className={styles.count}>{isOpen ? "Idle" : "Open"}</span>
      </div>

      {!isOpen ? (
        <div className={styles.sessionClosed}>
          <p className={styles.presenceIntro}>
            Open the shared session to inspect its durable state and ordered
            turn queue.
          </p>
          <button
            className={styles.fixtureAction}
            type="button"
            onClick={() => setIsOpen(true)}
          >
            Open shared session
          </button>
        </div>
      ) : (
        <div className={styles.sessionSurface} aria-label="Open shared session">
          <div className={styles.sessionMetadata} aria-label="Session metadata">
            <div>
              <span className={styles.label}>Provider</span>
              <strong>{fixtureSession.provider}</strong>
            </div>
            <div>
              <span className={styles.label}>Owner</span>
              <strong>Alex Morgan</strong>
            </div>
            <div>
              <span className={styles.label}>Worktree</span>
              <code>agent-alex</code>
            </div>
            <div>
              <span className={styles.label}>State</span>
              <strong>
                {controlledTurnState === "running"
                  ? "Running · turn 3"
                  : controlledTurnState === "interrupted"
                    ? "Interrupted · turn 3"
                    : queue.length > 0
                      ? "Queued · awaiting turn"
                      : hasTranscript
                        ? "Completed · 2 turns"
                        : "Idle · awaiting instruction"}
              </strong>
            </div>
            <div>
              <span className={styles.label}>Model / configuration</span>
              <strong>{fixtureSession.model} · standard</strong>
            </div>
          </div>

          <div className={styles.sessionQueue} aria-label="Ordered turn queue">
            <div className={styles.sessionQueueHeader}>
              <div>
                <span className={styles.label}>Ordered turn queue</span>
                <strong>{queue.length} queued</strong>
              </div>
              <span className={styles.liveBadge}>Live · durable</span>
            </div>
            {!queuedInstruction ? (
              <p className={styles.sessionQueueEmpty}>
                {hasTranscript
                  ? "Queue is empty — the completed transcript is shown below."
                  : "Queue is empty — no instructions are waiting."}
              </p>
            ) : (
              <div
                className={styles.queueEntry}
                aria-label="Queued instruction"
              >
                <div className={styles.transcriptTurnHeader}>
                  <span className={styles.transcriptPosition}>Turn 1</span>
                  <strong>
                    {fixtureMembers.jordan.name} · {fixtureMembers.jordan.role}
                  </strong>
                </div>
                <p className={styles.transcriptPrompt}>
                  {queuedInstruction.prompt}
                </p>
                <p className={styles.transcriptTool}>
                  Attribution ·{" "}
                  <code>authorId {queuedInstruction.authorId}</code>
                </p>
              </div>
            )}
          </div>

          <section
            className={styles.sessionTurnPanel}
            aria-label="Controlled fixture turn"
          >
            <div className={styles.sessionQueueHeader}>
              <div>
                <span className={styles.label}>Controlled fixture turn</span>
                <strong>
                  {controlledTurnState === "idle"
                    ? "Ready to run"
                    : controlledTurnState === "running"
                      ? "Turn 3 · running"
                      : "Turn 3 · interrupted"}
                </strong>
              </div>
              <span className={styles.liveBadge}>
                {controlledTurnState === "interrupted"
                  ? "Cancellation recorded"
                  : controlledTurnState === "running"
                    ? "Live · cancellable"
                    : "Fixture control"}
              </span>
            </div>
            {controlledTurnState === "idle" ? (
              <>
                <p className={styles.observerCopy}>
                  Start a controlled turn with one completed tool result and a
                  second tool waiting, so an eligible collaborator can cancel it
                  safely.
                </p>
                <button
                  className={styles.fixtureAction}
                  type="button"
                  onClick={startControlledTurn}
                >
                  Start controlled fixture turn
                </button>
              </>
            ) : (
              <>
                <p className={styles.observerState} aria-live="polite">
                  {controlledTurnState === "running"
                    ? "Tool activity · write_file · waiting for completion."
                    : `Cancellation recorded by ${interruptedBy}. No further tool calls will run.`}
                </p>
                <div
                  className={styles.lastCompletedAction}
                  aria-label="Last completed action"
                >
                  <span className={styles.label}>Last completed action</span>
                  <strong>{fixtureCompletedAction.tool}</strong>
                  <p>{fixtureCompletedAction.output}</p>
                </div>
              </>
            )}
          </section>

          <div className={styles.coSteeringGrid}>
            <section
              className={styles.coSteeringPanel}
              aria-label="Jordan Lee collaborator controls"
            >
              <div className={styles.sessionQueueHeader}>
                <div>
                  <span className={styles.label}>
                    Fixture B · eligible collaborator
                  </span>
                  <strong>{fixtureMembers.jordan.name}</strong>
                </div>
                <span className={styles.liveBadge}>Can co-steer</span>
              </div>
              <label
                className={styles.promptLabel}
                htmlFor="shared-session-prompt"
              >
                Instruction to queue
              </label>
              <textarea
                className={styles.promptInput}
                id="shared-session-prompt"
                value={draftPrompt}
                onChange={(event) => setDraftPrompt(event.target.value)}
                placeholder="Ask the shared agent to inspect a file…"
                disabled={queue.length > 0}
              />
              <button
                className={styles.fixtureAction}
                type="button"
                onClick={queueJordanInstruction}
                disabled={!draftPrompt.trim() || queue.length > 0}
              >
                {queue.length > 0
                  ? "Instruction queued"
                  : "Queue instruction as Jordan"}
              </button>
              <button
                className={styles.fixtureAction}
                type="button"
                onClick={interruptControlledTurn}
                disabled={controlledTurnState !== "running"}
              >
                {controlledTurnState === "interrupted"
                  ? "Turn interrupted"
                  : "Interrupt running turn as Jordan"}
              </button>
            </section>

            <section
              className={styles.coSteeringPanel}
              aria-label="Alex Morgan live observer"
            >
              <div className={styles.sessionQueueHeader}>
                <div>
                  <span className={styles.label}>
                    Fixture A · live observer
                  </span>
                  <strong>{fixtureMembers.alex.name}</strong>
                </div>
                <span className={styles.liveBadge}>Watching live</span>
              </div>
              <p className={styles.observerCopy}>
                Alex sees the same attributed queue as soon as Jordan submits.
              </p>
              <p className={styles.observerState} aria-live="polite">
                {controlledTurnState === "interrupted"
                  ? "Alex sees Jordan's cancellation and the preserved last completed action."
                  : controlledTurnState === "running"
                    ? "Alex sees the running turn and its last completed action."
                    : queue.length > 0
                      ? `Jordan's instruction is visible to ${fixtureMembers.alex.name}.`
                      : "Waiting for Jordan to queue one instruction."}
              </p>
            </section>
          </div>

          <div
            className={styles.ineligibleCoSteer}
            aria-label="Casey Rivera access"
          >
            <span>
              {fixtureMembers.casey.name} · {fixtureMembers.casey.role}
            </span>
            <div>
              <button type="button" disabled>
                Queue instruction · unavailable
              </button>
              <button type="button" disabled>
                Interrupt turn · unavailable
              </button>
            </div>
          </div>

          {!hasTranscript ? (
            <button
              className={styles.fixtureAction}
              type="button"
              onClick={() => setHasTranscript(true)}
            >
              Run fixture transcript
            </button>
          ) : (
            <div
              className={styles.sessionTranscript}
              aria-label="Ordered transcript"
            >
              <div className={styles.sessionQueueHeader}>
                <div>
                  <span className={styles.label}>Ordered transcript</span>
                  <strong>{fixtureTranscript.length} completed turns</strong>
                </div>
                <span className={styles.liveBadge}>Replayable</span>
              </div>
              <div className={styles.transcriptList}>
                {fixtureTranscript.map((turn) => (
                  <article
                    className={styles.transcriptTurn}
                    key={turn.position}
                  >
                    <div className={styles.transcriptTurnHeader}>
                      <span className={styles.transcriptPosition}>
                        Turn {turn.position}
                      </span>
                      <strong>{turn.author}</strong>
                    </div>
                    <p className={styles.transcriptPrompt}>{turn.prompt}</p>
                    <p className={styles.transcriptTool}>
                      Tool activity · <code>{turn.tool}</code>
                    </p>
                    <p className={styles.transcriptOutput}>
                      <span className={styles.label}>Output</span>
                      {turn.output}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          )}

          <p className={styles.note}>
            Shared context is the visible session transcript and repository
            state. No provider credentials or hidden account context are shared.
          </p>
        </div>
      )}

      <p className={styles.viewerStatus} role="status">
        {isOpen
          ? queue.length > 0
            ? "Jordan's instruction is queued and attributed for every session member."
            : controlledTurnState === "interrupted"
              ? "Turn 3 was interrupted by Jordan; the last completed action remains visible to every member."
              : controlledTurnState === "running"
                ? "Controlled turn 3 is running; Jordan can interrupt it with co-steer permission."
                : hasTranscript
                  ? "Shared session transcript is complete and ordered by turn."
                  : "Shared session is open and idle with an empty ordered queue."
          : "Open the session to view its idle queue."}
      </p>
    </section>
  );
}
