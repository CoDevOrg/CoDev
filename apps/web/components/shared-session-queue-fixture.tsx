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

export function SharedSessionQueueFixture() {
  const [isOpen, setIsOpen] = useState(false);

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
              <strong>Idle · awaiting instruction</strong>
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
              Queue is empty — no instructions are waiting.
            </p>
          </div>

          <p className={styles.note}>
            Shared context is the visible session transcript and repository
            state. No provider credentials or hidden account context are shared.
          </p>
        </div>
      )}

      <p className={styles.viewerStatus} role="status">
        {isOpen
          ? "Shared session is open and idle with an empty ordered queue."
          : "Open the session to view its idle queue."}
      </p>
    </section>
  );
}
