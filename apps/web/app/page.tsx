import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Check,
  Eye,
  GitPullRequest,
  MessageSquare,
  Play,
} from "lucide-react";

import styles from "./landing.module.css";

import { Brand } from "@/components/app-chrome";
import { LandingLiveDemo } from "@/components/landing-live-demo";
import { getCurrentAppUser } from "@/lib/identity";

export const metadata: Metadata = {
  title: "The multiplayer IDE for people and AI agents",
  description:
    "Run Codex and Claude side by side in one shared browser workspace. Watch, steer, and review agent work with your software team.",
};

const workflow = [
  {
    title: "Connect your repository",
    copy: "Open the GitHub project your team already uses in a hosted CoDev workspace.",
  },
  {
    title: "Work with people and agents",
    copy: "Invite teammates, start Codex and Claude sessions, and see every active task in one place.",
  },
  {
    title: "Steer, review, and ship",
    copy: "Guide either agent while it works, inspect the shared changes, and merge with the full story intact.",
  },
] as const;

export default async function HomePage() {
  if (await getCurrentAppUser()) {
    redirect("/dashboard");
  }

  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Brand />
        <nav aria-label="Primary navigation">
          <a href="#product">Product</a>
          <a href="#why-codev">Why CoDev</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <div className={styles.navActions}>
          <Link className={styles.signIn} href="/sign-in">
            Sign in
          </Link>
          <Link className={styles.navCta} href="/sign-in">
            Start a workspace <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className={styles.hero} id="product">
        <div className={styles.heroCopy}>
          <p className={styles.categoryLine}>
            <span aria-hidden="true" /> Multiplayer agentic IDE
          </p>
          <h1>
            The multiplayer IDE for people and <strong>AI agents.</strong>
          </h1>
          <p className={styles.heroLede}>
            Run Codex and Claude side by side. See who asked what, watch both
            agents work, steer either session, and review every change together
            from the browser.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/sign-in">
              Start a shared workspace <ArrowRight aria-hidden="true" />
            </Link>
            <a className={styles.secondaryAction} href="#live-collaboration">
              <Play aria-hidden="true" /> Watch it work
            </a>
          </div>
          <p className={styles.heroAudience}>
            For software teams building with Codex, Claude, and GitHub.
          </p>
        </div>

        <LandingLiveDemo />
      </section>

      <section className={styles.collaboration} id="live-collaboration">
        <header className={styles.sectionHeading}>
          <div>
            <p>Multiplayer by default</p>
            <h2>Two people. Two agents. One shared repo.</h2>
          </div>
          <p>
            CoDev turns agent work from a private conversation into a shared
            team activity. Everyone sees the work early enough to improve it.
          </p>
        </header>

        <div className={styles.proofSequence}>
          <article className={styles.proofStep}>
            <div className={styles.proofCopy}>
              <span className={styles.proofIcon}>
                <Eye aria-hidden="true" />
              </span>
              <h3>See every agent at work</h3>
              <p>
                Know who started each session, what it is changing, and whether
                it needs help.
              </p>
            </div>
            <div
              className={styles.sessionList}
              aria-label="Two active sessions"
            >
              <div>
                <span className={styles.codexDot} />
                <p>
                  <strong>Codex</strong>
                  <span>Refactoring the parser</span>
                </p>
                <small>Working</small>
              </div>
              <div>
                <span className={styles.claudeDot} />
                <p>
                  <strong>Claude</strong>
                  <span>Adding calendar sync</span>
                </p>
                <small>Working</small>
              </div>
            </div>
          </article>

          <article className={styles.proofStep}>
            <div className={styles.proofCopy}>
              <span className={styles.proofIcon}>
                <MessageSquare aria-hidden="true" />
              </span>
              <h3>Steer together</h3>
              <p>
                Add context or redirect the approach without taking over the
                session or starting another private thread.
              </p>
            </div>
            <div className={styles.steerPreview}>
              <div>
                <span>Y</span>
                <p>Keep the retry path idempotent.</p>
              </div>
              <div>
                <span>C</span>
                <p>Got it. I&apos;m updating the plan and tests.</p>
              </div>
              <small>Everyone in the workspace sees this context.</small>
            </div>
          </article>

          <article className={styles.proofStep}>
            <div className={styles.proofCopy}>
              <span className={styles.proofIcon}>
                <GitPullRequest aria-hidden="true" />
              </span>
              <h3>Review before merge</h3>
              <p>
                Follow the diff while it develops, leave direction early, and
                review the complete story before anything ships.
              </p>
            </div>
            <div className={styles.reviewPreview}>
              <div>
                <Check aria-hidden="true" />
                <p>
                  <strong>Ready for review</strong>
                  <span>14 files changed by two agent sessions</span>
                </p>
              </div>
              <span className={styles.diffAdded}>+92</span>
              <span className={styles.diffRemoved}>-18</span>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.why} id="why-codev">
        <div className={styles.whyCopy}>
          <p>Why CoDev</p>
          <h2>AI made coding faster. It left teamwork behind.</h2>
          <p>
            Agent sessions still happen in private chats and local tools.
            Teammates discover overlapping work too late, decisions disappear,
            and review starts after the expensive choices are already made.
          </p>
        </div>

        <div className={styles.comparison}>
          <section className={styles.comparisonBefore}>
            <span>Solo AI editors</span>
            <h3>Private work, shared too late</h3>
            <ul>
              <li>Prompts live on one person&apos;s machine</li>
              <li>Agents collide without knowing it</li>
              <li>Review begins after the handoff</li>
            </ul>
          </section>
          <ArrowRight className={styles.comparisonArrow} aria-hidden="true" />
          <section className={styles.comparisonAfter}>
            <span>With CoDev</span>
            <h3>One room for the whole story</h3>
            <ul>
              <li>Sessions and ownership stay visible</li>
              <li>People steer while agents work</li>
              <li>Changes arrive with their context</li>
            </ul>
          </section>
        </div>
      </section>

      <section className={styles.how} id="how-it-works">
        <header className={styles.howHeading}>
          <p>From repository to review</p>
          <h2>Start together. Stay together.</h2>
        </header>
        <ol className={styles.workflow}>
          {workflow.map((step, index) => (
            <li key={step.title}>
              <span>{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </div>
              {index < workflow.length - 1 ? (
                <ArrowRight aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.finalCta}>
        <div>
          <p>People and AI agents, building in the same room.</p>
          <h2>Bring your team into the work.</h2>
        </div>
        <Link className={styles.finalCtaAction} href="/sign-in">
          Start a shared workspace <ArrowRight aria-hidden="true" />
        </Link>
      </section>

      <footer className={styles.footer}>
        <Brand />
        <p>The hosted multiplayer IDE for software teams and AI agents.</p>
        <Link href="/sign-in">Sign in</Link>
      </footer>
    </main>
  );
}
