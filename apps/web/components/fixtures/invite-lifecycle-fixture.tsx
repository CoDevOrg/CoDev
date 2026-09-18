"use client";

import { useState } from "react";

import styles from "@/app/verification/b0-2/fixture.module.css";

const owner = {
  name: "Alex Morgan",
  role: "Maintainer",
};

const recipient = {
  name: "Jordan Lee",
  role: "Collaborator",
};

type InviteStatus = "idle" | "created" | "accepted" | "revoked" | "expired";

export function InviteLifecycleFixture() {
  const [status, setStatus] = useState<InviteStatus>("idle");
  const [acceptAttempted, setAcceptAttempted] = useState(false);

  const inviteCreated = status !== "idle";
  const inviteAccepted = status === "accepted";
  const inviteBlocked = status === "revoked" || status === "expired";

  function attemptAccept() {
    if (inviteBlocked) {
      setAcceptAttempted(true);
      return;
    }
    setStatus("accepted");
  }

  return (
    <section
      className={`${styles.card} ${styles.inviteLifecycle}`}
      aria-labelledby="invite-heading"
    >
      <div className={styles.cardHeading}>
        <div>
          <span className={styles.kicker}>F1.2 · invite lifecycle</span>
          <h2 id="invite-heading">Invite and accept once</h2>
        </div>
        <span className={styles.count}>
          {inviteAccepted ? "Live" : inviteBlocked ? "Blocked" : "2 steps"}
        </span>
      </div>

      <div className={styles.inviteSteps} aria-label="Invite lifecycle steps">
        <div className={styles.inviteStep}>
          <span className={styles.stepNumber}>1</span>
          <div>
            <strong>{owner.name}</strong>
            <span>{owner.role} · workspace owner</span>
          </div>
          <button
            className={styles.fixtureAction}
            type="button"
            disabled={inviteCreated}
            onClick={() => setStatus("created")}
          >
            {inviteCreated ? "Invite created" : "Create invite"}
          </button>
          {inviteCreated && !inviteAccepted && !inviteBlocked ? (
            <div className={styles.inviteActions}>
              <button
                className={styles.fixtureAction}
                type="button"
                onClick={() => setStatus("revoked")}
              >
                Revoke invite
              </button>
              <button
                className={styles.fixtureAction}
                type="button"
                onClick={() => setStatus("expired")}
              >
                Simulate expiry
              </button>
            </div>
          ) : null}
        </div>

        <div className={styles.inviteStep}>
          <span className={styles.stepNumber}>2</span>
          <div>
            <strong>{recipient.name}</strong>
            <span>{recipient.role} · second fixture</span>
          </div>
          <button
            className={styles.fixtureAction}
            type="button"
            disabled={
              !inviteCreated ||
              inviteAccepted ||
              (inviteBlocked && acceptAttempted)
            }
            onClick={attemptAccept}
          >
            {inviteAccepted
              ? "Invite already used"
              : inviteBlocked && acceptAttempted
                ? "Join rejected"
                : "Accept as Jordan"}
          </button>
        </div>
      </div>

      {inviteCreated ? (
        <div
          className={styles.inviteTicket}
          aria-label="Created invite details"
        >
          <div>
            <span className={styles.label}>Time-limited invite</span>
            <code>/invites/fixture-invite-24h</code>
          </div>
          <span>
            {status === "revoked"
              ? "Revoked by Alex · cannot be accepted"
              : status === "expired"
                ? "Expired · cannot be accepted"
                : "Expires in 24 hours · single use"}
          </span>
        </div>
      ) : (
        <p className={styles.note}>
          The owner can create a link for the second fixture. It is time-limited
          and becomes invalid after one acceptance.
        </p>
      )}

      <div className={styles.presencePanel} aria-label="Invite member presence">
        <div>
          <span className={styles.presenceDot} aria-hidden="true" />
          <span>
            <strong>{owner.name}</strong> · present as {owner.role}
          </span>
        </div>
        <div className={inviteAccepted ? undefined : styles.presencePending}>
          <span className={styles.presenceDot} aria-hidden="true" />
          <span>
            <strong>{recipient.name}</strong> ·{" "}
            {inviteAccepted
              ? "joined via invite"
              : inviteBlocked && acceptAttempted
                ? "join rejected"
                : "waiting for invite"}
          </span>
        </div>
      </div>

      <p className={styles.inviteStatus} role="status">
        {inviteAccepted
          ? "Jordan is now present. This invite was accepted once and cannot be reused."
          : status === "revoked" && acceptAttempted
            ? "Jordan cannot join: Alex revoked this invite before acceptance."
            : status === "expired" && acceptAttempted
              ? "Jordan cannot join: this invite expired before acceptance."
              : status === "revoked"
                ? "Invite revoked. Jordan can no longer use this link."
                : status === "expired"
                  ? "Invite expired. Jordan can no longer use this link."
                  : inviteCreated
                    ? "Invite ready for Jordan to accept."
                    : "Owner action required: create the invite first."}
      </p>
    </section>
  );
}
