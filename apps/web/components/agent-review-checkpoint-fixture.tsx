"use client";

import { useState } from "react";

import styles from "@/app/verification/b0-2/fixture.module.css";

const reviewCheckpoint = Object.freeze({
  baseRevision: "fixture-main-r1",
  headRevision: "fixture-agent-r2",
  diffDigest:
    "sha256:3f7a2c8d9b1e4f605a7c9d2e8b6f104c3d5e7a9b1c2d4f608e9a7b5c3d1f2e4",
});

const reviewDiff = Object.freeze({
  summary: "3 paths changed · 2 text files · 1 binary file",
  additions: 14,
  deletions: 3,
  paths: [
    {
      path: "README.md",
      kind: "modified",
      detail: "+8 −2 lines",
    },
    {
      path: "src/hello.ts",
      kind: "modified",
      detail: "+6 −1 line",
    },
    {
      path: "assets/logo.png",
      kind: "binary",
      detail: "Binary file · content omitted",
    },
  ],
});

export function AgentReviewCheckpointFixture() {
  const [checkpoint, setCheckpoint] = useState<typeof reviewCheckpoint | null>(
    null,
  );
  const [reviewOpen, setReviewOpen] = useState(false);

  return (
    <section
      className={`${styles.card} ${styles.reviewCheckpointCard}`}
      aria-labelledby="agent-review-checkpoint-heading"
    >
      <div className={styles.cardHeading}>
        <div>
          <span className={styles.kicker}>F5.1 · Review preparation</span>
          <h2 id="agent-review-checkpoint-heading">Agent review checkpoint</h2>
        </div>
        <span className={styles.count}>{checkpoint ? "Ready" : "Draft"}</span>
      </div>
      <p className={styles.note}>
        Freeze the exact fixture worktree revision before a collaborator opens
        it for review. The checkpoint records both revisions and its diff
        digest.
      </p>
      <div
        className={styles.reviewCheckpointAttempt}
        aria-label="Review checkpoint action"
      >
        <div>
          <span className={styles.label}>Agent slot 1 · Repository map</span>
          <strong>Worktree status: {checkpoint ? "Frozen" : "Active"}</strong>
        </div>
        <button
          className={styles.fixtureAction}
          type="button"
          onClick={() => setCheckpoint(reviewCheckpoint)}
          disabled={checkpoint !== null}
        >
          {checkpoint ? "Checkpoint prepared" : "Mark review-ready"}
        </button>
      </div>
      {checkpoint ? (
        <div
          className={styles.reviewCheckpointDetails}
          role="status"
          aria-label="Immutable review checkpoint"
        >
          <div className={styles.reviewCheckpointStatus}>
            <strong>Review ready · immutable checkpoint</strong>
            <span>Further writes must create a new checkpoint.</span>
          </div>
          <dl className={styles.reviewMetadata}>
            <div>
              <dt>Base revision</dt>
              <dd>{checkpoint.baseRevision}</dd>
            </div>
            <div>
              <dt>Proposed revision</dt>
              <dd>{checkpoint.headRevision}</dd>
            </div>
            <div>
              <dt>Diff digest</dt>
              <dd>{checkpoint.diffDigest}</dd>
            </div>
          </dl>
          <button
            className={styles.fixtureAction}
            type="button"
            onClick={() => setReviewOpen(true)}
            disabled={reviewOpen}
          >
            {reviewOpen ? "Diff review open" : "Open diff review"}
          </button>
          {reviewOpen ? (
            <div
              className={styles.reviewDiffPanel}
              role="region"
              aria-label="Review diff and affected paths"
            >
              <div className={styles.reviewDiffSummary}>
                <div>
                  <span className={styles.label}>Diff summary</span>
                  <strong>{reviewDiff.summary}</strong>
                </div>
                <div>
                  <span className={styles.label}>Text delta</span>
                  <strong>
                    +{reviewDiff.additions} −{reviewDiff.deletions} lines
                  </strong>
                </div>
              </div>
              <div>
                <span className={styles.label}>Affected paths</span>
                <ul className={styles.reviewPathList}>
                  {reviewDiff.paths.map((entry) => (
                    <li key={entry.path}>
                      <code>{entry.path}</code>
                      <span>
                        {entry.kind} · {entry.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className={styles.reviewBinaryNote}>
                Binary content is not rendered as text; review remains safe for
                binary and generated files.
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className={styles.fixtureStatus} role="status">
          No review checkpoint prepared yet.
        </p>
      )}
    </section>
  );
}
