"use client";

import { useState } from "react";

import styles from "@/app/verification/b0-2/fixture.module.css";

const reviewCheckpoint = Object.freeze({
  baseRevision: "fixture-main-r1",
  headRevision: "fixture-agent-r2",
  advancedIntegrationHeadRevision: "fixture-main-r2",
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

const integrationAudit = Object.freeze({
  actor: "Alex Morgan",
  role: "Maintainer",
  event: "review.checkpoint_integrated",
});

const discardAudit = Object.freeze({
  actor: "Alex Morgan",
  role: "Maintainer",
  event: "agent.review_discarded",
});

export function AgentReviewCheckpointFixture() {
  const [checkpoint, setCheckpoint] = useState<typeof reviewCheckpoint | null>(
    null,
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [integrationHeadRevision, setIntegrationHeadRevision] =
    useState<string>(reviewCheckpoint.baseRevision);
  const [approvalBlocked, setApprovalBlocked] = useState(false);
  const [integrationCompleted, setIntegrationCompleted] = useState(false);
  const [proposalDiscarded, setProposalDiscarded] = useState(false);
  const [discardRepeated, setDiscardRepeated] = useState(false);

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
        <span className={styles.count}>
          {integrationCompleted ? "Integrated" : checkpoint ? "Ready" : "Draft"}
        </span>
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
          <strong>
            Worktree status:{" "}
            {proposalDiscarded ? "Removed" : checkpoint ? "Frozen" : "Active"}
          </strong>
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
          <div
            className={styles.reviewApprovalPanel}
            role="region"
            aria-label="Review approval gate"
          >
            <div className={styles.reviewApprovalHeader}>
              <div>
                <span className={styles.label}>Integration head</span>
                <strong>{integrationHeadRevision}</strong>
              </div>
              <span className={styles.reviewApprovalState}>
                {integrationCompleted
                  ? "Integrated"
                  : approvalBlocked
                    ? "Stale"
                    : "Current"}
              </span>
            </div>
            <p className={styles.reviewApprovalNote}>
              Approval rechecks the integration head before any merge action
              starts.
            </p>
            <div className={styles.reviewApprovalActions}>
              <button
                className={styles.fixtureAction}
                type="button"
                onClick={() =>
                  setIntegrationHeadRevision(
                    reviewCheckpoint.advancedIntegrationHeadRevision,
                  )
                }
                disabled={
                  approvalBlocked ||
                  integrationCompleted ||
                  integrationHeadRevision ===
                    reviewCheckpoint.advancedIntegrationHeadRevision
                }
              >
                {integrationHeadRevision ===
                reviewCheckpoint.advancedIntegrationHeadRevision
                  ? "Integration head advanced"
                  : "Advance integration head"}
              </button>
              <button
                className={styles.fixtureAction}
                type="button"
                onClick={() => {
                  if (integrationHeadRevision !== checkpoint.baseRevision) {
                    setApprovalBlocked(true);
                    return;
                  }
                  setIntegrationHeadRevision(checkpoint.headRevision);
                  setIntegrationCompleted(true);
                }}
                disabled={approvalBlocked || integrationCompleted}
              >
                {approvalBlocked
                  ? "Approval blocked"
                  : integrationCompleted
                    ? "Checkpoint integrated"
                    : "Approve checkpoint"}
              </button>
            </div>
            {integrationHeadRevision !== reviewCheckpoint.baseRevision &&
            !approvalBlocked ? (
              <p className={styles.reviewApprovalStatus}>
                Integration head changed to {integrationHeadRevision}.
              </p>
            ) : null}
            {approvalBlocked ? (
              <div className={styles.reviewStaleAlert} role="alert">
                <strong>Stale checkpoint · approval blocked</strong>
                <span>
                  The integration worktree advanced from{" "}
                  {checkpoint.baseRevision} to {integrationHeadRevision}.
                </span>
                <span>Rebase and review again before approval.</span>
                <span>No merge action started.</span>
              </div>
            ) : null}
            {integrationCompleted ? (
              <div
                className={styles.reviewIntegrationResult}
                role="status"
                aria-label="Integration and audit result"
              >
                <strong>
                  Integrated exactly one current reviewed checkpoint
                </strong>
                <span>
                  The integration head advanced to {checkpoint.headRevision}.
                </span>
                <dl className={styles.reviewMetadata}>
                  <div>
                    <dt>Merge actor</dt>
                    <dd>
                      {integrationAudit.actor} · {integrationAudit.role}
                    </dd>
                  </div>
                  <div>
                    <dt>Audit event</dt>
                    <dd>
                      <code>{integrationAudit.event}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Reviewed revision</dt>
                    <dd>
                      {checkpoint.baseRevision} → {checkpoint.headRevision}
                    </dd>
                  </div>
                </dl>
                <span>Duplicate approval is disabled for this checkpoint.</span>
              </div>
            ) : null}
            <div
              className={styles.reviewDiscardPanel}
              role="region"
              aria-label="Discard proposal action"
            >
              <div className={styles.reviewApprovalHeader}>
                <div>
                  <span className={styles.label}>Proposal lifecycle</span>
                  <strong>
                    {proposalDiscarded
                      ? "Worktree and claims removed"
                      : "Keep or discard this proposal"}
                  </strong>
                </div>
                <span className={styles.reviewApprovalState}>
                  {proposalDiscarded ? "Discarded" : "Reviewable"}
                </span>
              </div>
              <p className={styles.reviewApprovalNote}>
                Discard removes the fixture worktree and releases its active or
                contested path claims without changing integration.
              </p>
              <button
                className={styles.fixtureAction}
                type="button"
                onClick={() => {
                  if (proposalDiscarded) {
                    setDiscardRepeated(true);
                    return;
                  }
                  setProposalDiscarded(true);
                }}
                disabled={integrationCompleted}
              >
                {proposalDiscarded
                  ? "Discard proposal again (idempotent)"
                  : "Discard proposal"}
              </button>
              {proposalDiscarded ? (
                <div
                  className={styles.reviewDiscardResult}
                  role="status"
                  aria-label="Discard result"
                >
                  <strong>Proposal discarded · final state</strong>
                  <span>
                    Worktree fixture-agent-1 removed from the sandbox.
                  </span>
                  <span>Claims released: README.md and src/**.</span>
                  <dl className={styles.reviewMetadata}>
                    <div>
                      <dt>Discard actor</dt>
                      <dd>
                        {discardAudit.actor} · {discardAudit.role}
                      </dd>
                    </div>
                    <div>
                      <dt>Audit event</dt>
                      <dd>
                        <code>{discardAudit.event}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Integration checkout</dt>
                      <dd>Unchanged at {reviewCheckpoint.baseRevision}</dd>
                    </div>
                  </dl>
                  <span>
                    {discardRepeated
                      ? "Repeated discard was a no-op; worktree and claims remain removed."
                      : "A repeated discard is a no-op; this proposal remains discarded."}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <p className={styles.fixtureStatus} role="status">
          No review checkpoint prepared yet.
        </p>
      )}
    </section>
  );
}
