import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MAX_PARALLEL_AGENT_SESSIONS } from "@codev/contracts";

import {
  isVerificationFixtureEnabled,
  verificationFixture,
} from "@/lib/verification-fixture";

import styles from "./fixture.module.css";

export const metadata: Metadata = {
  title: "B0.2 verification fixture",
};

export const dynamic = "force-dynamic";

export default function VerificationFixturePage() {
  if (!isVerificationFixtureEnabled()) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CoDev · verification fixture</p>
            <h1>{verificationFixture.name}</h1>
            <p className={styles.subtitle}>
              A stable, local-only workspace surface for browser verification.
            </p>
          </div>
          <span className={styles.readyBadge}>
            <span aria-hidden="true" />
            {verificationFixture.status}
          </span>
        </header>

        <section
          className={styles.summary}
          aria-label="Fixture workspace details"
        >
          <div>
            <span className={styles.label}>Repository</span>
            <strong>{verificationFixture.repository}</strong>
          </div>
          <div>
            <span className={styles.label}>Branch</span>
            <strong>{verificationFixture.branch}</strong>
          </div>
          <div>
            <span className={styles.label}>Workspace path</span>
            <strong>{verificationFixture.workspacePath}</strong>
          </div>
          <div aria-label="Agent worktree capacity">
            <span className={styles.label}>Agent worktrees</span>
            <strong>{MAX_PARALLEL_AGENT_SESSIONS} slots available</strong>
          </div>
        </section>

        <div className={styles.columns}>
          <section className={styles.card} aria-labelledby="members-heading">
            <div className={styles.cardHeading}>
              <div>
                <span className={styles.kicker}>Fixture identities</span>
                <h2 id="members-heading">Ready-to-use members</h2>
              </div>
              <span className={styles.count}>
                {verificationFixture.members.length}
              </span>
            </div>
            <div className={styles.memberList}>
              {verificationFixture.members.map((member) => (
                <article className={styles.member} key={member.id}>
                  <span className={styles.avatar} aria-hidden="true">
                    {member.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")}
                  </span>
                  <div>
                    <strong>{member.name}</strong>
                    <span>{member.email}</span>
                  </div>
                  <span className={styles.role}>{member.role}</span>
                </article>
              ))}
            </div>
            <p className={styles.note}>
              These are display-only fixtures. No passwords, tokens, or provider
              credentials are stored or requested.
            </p>
          </section>

          <section className={styles.card} aria-labelledby="files-heading">
            <div className={styles.cardHeading}>
              <div>
                <span className={styles.kicker}>Workspace contents</span>
                <h2 id="files-heading">Seeded files</h2>
              </div>
              <span className={styles.count}>
                {verificationFixture.files.length}
              </span>
            </div>
            <ul className={styles.fileList}>
              {verificationFixture.files.map((file) => (
                <li key={file}>
                  <span className={styles.fileIcon} aria-hidden="true">
                    ·
                  </span>
                  <code>{file}</code>
                  <span className={styles.fileState}>available</span>
                </li>
              ))}
            </ul>
            <p className={styles.note}>
              Open this page first in local development or a Vercel preview to
              confirm the verification environment is ready.
            </p>
          </section>
        </div>

        <footer className={styles.footer}>
          <span>B0.2 · stable local verification entry point</span>
          <span>Production fixture access is disabled by default.</span>
        </footer>
      </div>
    </main>
  );
}
