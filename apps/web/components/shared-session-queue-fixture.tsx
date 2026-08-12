"use client";

import { useState } from "react";

import { sharedSessionSchema } from "@codev/contracts";

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

export function SharedSessionQueueFixture() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasTranscript, setHasTranscript] = useState(false);

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
                {hasTranscript
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
                <strong>{fixtureSession.queue.length} queued</strong>
              </div>
              <span className={styles.liveBadge}>Durable</span>
            </div>
            <p className={styles.sessionQueueEmpty}>
              {hasTranscript
                ? "Queue is empty — the completed transcript is shown below."
                : "Queue is empty — no instructions are waiting."}
            </p>
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
          ? hasTranscript
            ? "Shared session transcript is complete and ordered by turn."
            : "Shared session is open and idle with an empty ordered queue."
          : "Open the session to view its idle queue."}
      </p>
    </section>
  );
}
