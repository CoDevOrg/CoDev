import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/app-chrome";
import { LandingAudience } from "@/components/landing-audience";
import { getCurrentAppUser } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Multiplayer AI for software teams",
  description:
    "CoDev is the shared workspace where software teams watch, steer, and ship with AI agents together.",
};

const capabilities = [
  {
    number: "01",
    title: "Watch the work, live",
    copy: "Follow every agent turn, terminal command, and code change as it happens. See the work before the pull request lands.",
    signal: "LIVE",
  },
  {
    number: "02",
    title: "Steer as a team",
    copy: "Add context, redirect the approach, or step in for a decision without starting another private thread.",
    signal: "CO STEER",
  },
  {
    number: "03",
    title: "Hand off everything",
    copy: "Pass along the code, runtime, conversation, and decisions. The next person continues with nothing to reconstruct.",
    signal: "PERSISTENT",
  },
];

const workflow = [
  ["Connect", "Open the GitHub repository your team already uses."],
  ["Collaborate", "People and agents work in one live cloud workspace."],
  ["Ship", "Review the full story, then merge with confidence."],
] as const;

export default async function HomePage() {
  if (await getCurrentAppUser()) {
    redirect("/dashboard");
  }

  return (
    <main className="landing-page">
      <div className="landing-grain" aria-hidden="true" />

      <header className="landing-nav">
        <Brand />
        <nav aria-label="Primary navigation">
          <a href="#why-codev">Why CoDev</a>
          <a href="#how-it-works">How it works</a>
          <Link className="landing-sign-in" href="/sign-in">
            Sign in <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">
            <span className="landing-eyebrow-dot" /> A shared workspace for
            software teams
          </p>
          <h1>
            Build software
            <br />
            <em>together.</em>
          </h1>
          <p className="landing-hero-lede">
            Create a shared workspace for every feature, bug, and investigation.
            Teammates and agents work inside it together, watching, steering,
            reviewing, and shipping with the complete context.
          </p>
          <div className="landing-hero-actions">
            <Link className="landing-primary-action" href="/sign-in">
              Start building together <span aria-hidden="true">↗</span>
            </Link>
            <a className="landing-text-action" href="#product">
              See the workspace <span aria-hidden="true">↓</span>
            </a>
          </div>
          <ul className="landing-hero-proof" aria-label="Product highlights">
            <li>
              <span aria-hidden="true">●</span> Watch live
            </li>
            <li>
              <span aria-hidden="true">↳</span> Redirect instantly
            </li>
            <li>
              <span aria-hidden="true">✓</span> Review before merge
            </li>
          </ul>
        </div>

        <div
          className="landing-product"
          id="product"
          aria-label="A preview of a live CoDev workspace"
        >
          <div className="landing-product-topbar">
            <div className="landing-window-controls" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="landing-repo-name">
              <span aria-hidden="true">⌘</span> acme / web
            </div>
            <div
              className="landing-presence"
              aria-label="Four collaborators online"
            >
              <span className="landing-avatar landing-avatar-a">YM</span>
              <span className="landing-avatar landing-avatar-b">AK</span>
              <span className="landing-avatar landing-avatar-c">AI</span>
              <strong>+1</strong>
            </div>
          </div>

          <div className="landing-product-body">
            <aside className="landing-product-sidebar">
              <p>Workspace</p>
              <ul>
                <li className="is-active">
                  <span>◉</span> Agent sessions <b>3</b>
                </li>
                <li>
                  <span>⌁</span> Changes <b>12</b>
                </li>
                <li>
                  <span>✓</span> Review
                </li>
              </ul>
              <div className="landing-sidebar-team">
                <p>In this room</p>
                <span>
                  <i className="landing-status-dot" /> Yousef
                </span>
                <span>
                  <i className="landing-status-dot" /> Alex
                </span>
                <span>
                  <i className="landing-status-dot landing-status-agent" />{" "}
                  Codex agent
                </span>
              </div>
            </aside>

            <div className="landing-session">
              <div className="landing-session-header">
                <div>
                  <p>Agent session</p>
                  <strong>Fix checkout race condition</strong>
                </div>
                <span className="landing-live-pill">
                  <i /> Running
                </span>
              </div>

              <div className="landing-session-feed">
                <div className="landing-feed-item">
                  <span className="landing-feed-avatar landing-feed-agent">
                    AI
                  </span>
                  <div>
                    <strong>
                      Codex <small>2m ago</small>
                    </strong>
                    <p>
                      I found the race between inventory reservation and payment
                      confirmation. I’m tracing both paths now.
                    </p>
                    <div className="landing-code-line">
                      <span>✓</span> Read 8 files &nbsp;·&nbsp; Running tests
                    </div>
                  </div>
                </div>
                <div className="landing-feed-item landing-feed-human">
                  <span className="landing-feed-avatar">AK</span>
                  <div>
                    <strong>
                      Alex <small>just now</small>
                    </strong>
                    <p>
                      Keep the reservation idempotent. We need retries to be
                      safe.
                    </p>
                  </div>
                </div>
                <div className="landing-agent-response">
                  <span className="landing-response-pulse" aria-hidden="true" />
                  Agent adjusted its plan with Alex&apos;s context
                </div>
              </div>

              <div className="landing-composer">
                <span>Add context or redirect the agent…</span>
                <button type="button" tabIndex={-1} aria-hidden="true">
                  Send ↗
                </button>
              </div>
            </div>
          </div>

          <div className="landing-product-caption">
            <span>
              <i /> Live workspace
            </span>
            <p>Everyone sees the same work. Anyone can move it forward.</p>
          </div>
        </div>
      </section>

      <LandingAudience />

      <section className="landing-problem" id="why-codev">
        <div className="landing-section-label">
          <span>Why now</span>
          <span>01 / 04</span>
        </div>
        <div className="landing-problem-grid">
          <h2>
            AI made coding faster. <em>It left teamwork behind.</em>
          </h2>
          <div className="landing-problem-copy">
            <p>
              The most powerful new member of your engineering team still works
              inside a private chat. Teammates see the result too late, context
              disappears, and handoffs start from scratch.
            </p>
            <strong>
              CoDev makes the workspace, not the chat, the center of the work.
            </strong>
          </div>
        </div>
        <div
          className="landing-contrast"
          aria-label="A comparison of private AI chats and CoDev"
        >
          <div className="landing-contrast-card landing-contrast-before">
            <span>Single player AI</span>
            <h3>
              Private prompts.
              <br />
              Late reviews.
              <br />
              Lost context.
            </h3>
            <p>Share a transcript and explain it all again.</p>
          </div>
          <div className="landing-contrast-arrow" aria-hidden="true">
            →
          </div>
          <div className="landing-contrast-card landing-contrast-after">
            <span>With CoDev</span>
            <h3>
              Shared sessions.
              <br />
              Live direction.
              <br />
              Continuous review.
            </h3>
            <p>Join the room and continue from the exact same state.</p>
          </div>
        </div>
      </section>

      <section className="landing-environment">
        <div className="landing-section-label">
          <span>One shared environment</span>
          <span>02 / 04</span>
        </div>
        <div className="landing-environment-panel">
          <div className="landing-environment-copy">
            <p className="landing-environment-kicker">Shared before you ship</p>
            <h2>
              Local changes should not be <em>local knowledge.</em>
            </h2>
            <p>
              Everyone in a CoDev workspace sees the same environment, active
              work, and code changes before anything is committed, pushed, or
              published.
            </p>
          </div>

          <div
            className="landing-workboard"
            aria-label="Shared work in progress"
          >
            <div className="landing-workboard-header">
              <div>
                <span className="landing-workboard-dot" />
                <strong>Live work</strong>
              </div>
              <small>3 people and 2 agents</small>
            </div>
            <div className="landing-workboard-item">
              <span className="landing-workboard-icon">B</span>
              <div>
                <strong>Checkout timeout</strong>
                <p>Yousef and Codex are editing</p>
              </div>
              <b>IN PROGRESS</b>
            </div>
            <div className="landing-workboard-item">
              <span className="landing-workboard-icon landing-workboard-icon-green">
                W
              </span>
              <div>
                <strong>Webhook retries</strong>
                <p>Alex is running tests</p>
              </div>
              <b>TESTING</b>
            </div>
            <div className="landing-workboard-change">
              <div>
                <span>12</span>
                <p>local changes visible to the room</p>
              </div>
              <small>Nothing published yet</small>
            </div>
            <div className="landing-workboard-alert">
              <span>✓</span>
              <p>
                Everyone can see this bug is already being handled before
                starting duplicate work.
              </p>
            </div>
          </div>
        </div>

        <div className="landing-environment-benefits">
          <article>
            <span>01</span>
            <h3>The same workspace</h3>
            <p>
              Open the same repository, runtime, files, and agent context from
              any browser.
            </p>
          </article>
          <article>
            <span>02</span>
            <h3>Work in progress is visible</h3>
            <p>
              See edits, terminal activity, and local changes while the work is
              still happening.
            </p>
          </article>
          <article>
            <span>03</span>
            <h3>Duplicate work stops early</h3>
            <p>
              Know who is handling a bug before two people spend time fixing the
              same problem twice.
            </p>
          </article>
        </div>
      </section>

      <section className="landing-capabilities" id="how-it-works">
        <div className="landing-section-label">
          <span>Multiplayer by default</span>
          <span>03 / 04</span>
        </div>
        <div className="landing-capabilities-heading">
          <h2>
            Agents do the work.
            <br />
            <em>Your team stays in control.</em>
          </h2>
          <p>
            Long running agent work becomes a shared, living process your whole
            team can understand and shape.
          </p>
        </div>
        <div className="landing-capability-grid">
          {capabilities.map((capability) => (
            <article key={capability.number}>
              <div className="landing-capability-meta">
                <span>{capability.number}</span>
                <b>
                  <i /> {capability.signal}
                </b>
              </div>
              <h3>{capability.title}</h3>
              <p>{capability.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-workflow">
        <div className="landing-section-label">
          <span>From repo to merge</span>
          <span>04 / 04</span>
        </div>
        <div className="landing-workflow-heading">
          <h2>One room for the whole story.</h2>
          <p>
            No new workflow to reconstruct. Start with your repository and keep
            every person, agent, decision, and change connected.
          </p>
        </div>
        <div className="landing-workflow-steps">
          {workflow.map(([title, copy], index) => (
            <div className="landing-workflow-step" key={title}>
              <span>0{index + 1}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
              {index < workflow.length - 1 ? <i aria-hidden="true">→</i> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <div>
          <p className="landing-eyebrow">Bring everyone into the room</p>
          <h2>
            AI coding is powerful.
            <br />
            <em>Together, it&apos;s transformative.</em>
          </h2>
        </div>
        <Link
          className="landing-primary-action landing-primary-action-light"
          href="/sign-in"
        >
          Build with CoDev <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <footer className="landing-footer">
        <Brand />
        <p>People and AI agents, building in the same room.</p>
        <span>Hosted on the web</span>
      </footer>
    </main>
  );
}
