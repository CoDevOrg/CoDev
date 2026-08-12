"use client";

import { useState } from "react";

import { MAX_PARALLEL_AGENT_SESSIONS } from "@codev/contracts";

import styles from "@/app/verification/b0-2/fixture.module.css";

type AttemptState = "idle" | "requesting" | "rejected";

export function AgentCapacityFixture() {
  const [attemptState, setAttemptState] = useState<AttemptState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function startFourthSession() {
    setAttemptState("requesting");
    setErrorMessage(null);

    const response = await fetch("/api/verification/b0-2/agent-capacity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeSessions: MAX_PARALLEL_AGENT_SESSIONS }),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setAttemptState("rejected");
      setErrorMessage(payload.error ?? "The server rejected this session.");
      return;
    }

    setAttemptState("idle");
  }

  return (
    <section
      className={`${styles.card} ${styles.agentCapacity}`}
      aria-labelledby="agent-capacity-guard-heading"
    >
      <div className={styles.cardHeading}>
        <div>
          <span className={styles.kicker}>F4.3 · Server-side guard</span>
          <h2 id="agent-capacity-guard-heading">Fourth-session check</h2>
        </div>
        <span className={styles.count}>409</span>
      </div>
      <p className={styles.note}>
        Three active sessions fill every worktree slot. Try the fourth request
        to see the server rejection and the next action for a collaborator.
      </p>
      <div className={styles.capacityAttempt}>
        <div>
          <span className={styles.label}>Request</span>
          <strong>Start agent session 04</strong>
        </div>
        <button
          className={styles.fixtureAction}
          type="button"
          onClick={startFourthSession}
          disabled={attemptState === "requesting"}
        >
          {attemptState === "requesting"
            ? "Checking capacity…"
            : "Start fourth session"}
        </button>
      </div>
      {attemptState === "rejected" && errorMessage ? (
        <div className={styles.capacityError} role="alert">
          <strong>Server rejected the fourth session · HTTP 409</strong>
          <span>{errorMessage}</span>
        </div>
      ) : (
        <p className={styles.fixtureStatus} role="status">
          No fourth-session request has been made yet.
        </p>
      )}
    </section>
  );
}
