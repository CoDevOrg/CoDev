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

type InviteStatus = "idle" | "created" | "accepted";

export function InviteLifecycleFixture() {
  const [status, setStatus] = useState<InviteStatus>("idle");

  const inviteCreated = status !== "idle";
  const inviteAccepted = status === "accepted";

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
          {inviteAccepted ? "Live" : "2 steps"}
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
            disabled={!inviteCreated || inviteAccepted}
            onClick={() => setStatus("accepted")}
          >
            {inviteAccepted ? "Invite already used" : "Accept as Jordan"}
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
          <span>Expires in 24 hours · single use</span>
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
            {inviteAccepted ? "joined via invite" : "waiting for invite"}
          </span>
        </div>
      </div>

      <p className={styles.inviteStatus} role="status">
        {inviteAccepted
          ? "Jordan is now present. This invite was accepted once and cannot be reused."
          : inviteCreated
            ? "Invite ready for Jordan to accept."
            : "Owner action required: create the invite first."}
      </p>
    </section>
  );
}
