"use client";

import { useState } from "react";

import styles from "@/app/verification/b0-2/fixture.module.css";

type ClaimState = "unclaimed" | "claimed" | "written";

const claimedPath = "README.md";
const claimedRevision = "fixture-r1";

export function AgentPathClaimFixture() {
  const [claimState, setClaimState] = useState<ClaimState>("unclaimed");

  const hasClaim = claimState !== "unclaimed";

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
            disabled={!hasClaim || claimState === "written"}
          >
            {claimState === "written" ? "Write accepted" : "Write README.md"}
          </button>
        </div>
      </div>
      {hasClaim ? (
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
        </div>
      ) : (
        <p className={styles.fixtureStatus} role="status">
          No active path claim · agent write is blocked.
        </p>
      )}
    </section>
  );
}
