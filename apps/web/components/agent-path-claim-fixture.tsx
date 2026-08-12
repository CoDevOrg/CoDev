"use client";

import { useState } from "react";

import styles from "@/app/verification/b0-2/fixture.module.css";

type ClaimState = "unclaimed" | "claimed" | "written";
type OverlapState = "none" | "contested" | "reassigned" | "cancelled";

const claimedPath = "README.md";
const claimedRevision = "fixture-r1";

export function AgentPathClaimFixture() {
  const [claimState, setClaimState] = useState<ClaimState>("unclaimed");
  const [overlapState, setOverlapState] = useState<OverlapState>("none");

  const hasClaim = claimState !== "unclaimed";
  const canWrite =
    claimState === "claimed" &&
    (overlapState === "none" || overlapState === "cancelled");

  return (
    <section
      className={`${styles.card} ${styles.agentCapacity}`}
      aria-labelledby="agent-path-claim-heading"
    >
      <div className={styles.cardHeading}>
        <div>
          <span className={styles.kicker}>F4.4 · Write boundary</span>
          <h2 id="agent-path-claim-heading">Agent write claim</h2>
        </div>
        <span className={styles.count}>Exact</span>
      </div>
      <p className={styles.note}>
        Agent slot 1 must claim the exact file at its current revision before a
        write is allowed.
      </p>
      <div className={styles.claimAttempt} aria-label="Agent workboard claim">
        <div className={styles.claimIdentity}>
          <span className={styles.label}>Agent slot 1 · Repository map</span>
          <strong>Claim target: {claimedPath}</strong>
        </div>
        <div className={styles.claimActions}>
          <button
            className={styles.fixtureAction}
            type="button"
            onClick={() => setClaimState("claimed")}
            disabled={hasClaim}
          >
            {hasClaim ? "Path claimed" : "Start agent claim"}
          </button>
          <button
            className={styles.fixtureActionSecondary}
            type="button"
            onClick={() => setClaimState("written")}
            disabled={!canWrite}
          >
            {claimState === "written" ? "Write accepted" : "Write README.md"}
          </button>
        </div>
      </div>
      {hasClaim && overlapState === "none" ? (
        <div className={styles.claimDetails} role="status">
          <div>
            <span>Claimed path</span>
            <code>{claimedPath}</code>
          </div>
          <div>
            <span>Revision</span>
            <code>{claimedRevision}</code>
          </div>
          <strong>
            {claimState === "written"
              ? `Agent write accepted for ${claimedPath}.`
              : "Claim active · agent write is now allowed."}
          </strong>
          {claimState === "claimed" ? (
            <button
              className={styles.fixtureActionSecondary}
              type="button"
              onClick={() => setOverlapState("contested")}
            >
              Request overlapping claim
            </button>
          ) : null}
        </div>
      ) : overlapState !== "none" ? (
        <>
          <div className={styles.claimConflict} role="alert">
            <strong>
              {overlapState === "contested"
                ? "Contested overlap · no silent overwrite"
                : overlapState === "reassigned"
                  ? "Claim reassigned to Agent slot 2"
                  : "Overlapping claim cancelled"}
            </strong>
            <span>
              {overlapState === "contested"
                ? "Agent slot 2 requested README.md, which is already claimed by Agent slot 1. Reassign or cancel before either agent writes."
                : overlapState === "reassigned"
                  ? "Agent slot 1 released README.md and Agent slot 2 now owns the path."
                  : "Agent slot 1 keeps README.md; Agent slot 2 did not overwrite the active claim."}
            </span>
          </div>
          <div className={styles.claimRows} aria-label="Overlapping claims">
            <div className={styles.claimRow}>
              <span>Agent slot 1 · Repository map</span>
              <code>
                {claimedPath} ·{" "}
                {overlapState === "reassigned" ? "Released" : "Contested"}
              </code>
            </div>
            <div className={styles.claimRow}>
              <span>Agent slot 2 · Documentation sync</span>
              <code>
                {claimedPath} ·{" "}
                {overlapState === "reassigned"
                  ? "Active"
                  : overlapState === "cancelled"
                    ? "Cancelled"
                    : "Contested"}
              </code>
            </div>
          </div>
          {overlapState === "contested" ? (
            <div className={styles.claimActions}>
              <button
                className={styles.fixtureAction}
                type="button"
                onClick={() => setOverlapState("reassigned")}
              >
                Reassign to slot 2
              </button>
              <button
                className={styles.fixtureActionSecondary}
                type="button"
                onClick={() => setOverlapState("cancelled")}
              >
                Cancel overlapping claim
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className={styles.fixtureStatus} role="status">
          No active path claim · agent write is blocked.
        </p>
      )}
    </section>
  );
}
