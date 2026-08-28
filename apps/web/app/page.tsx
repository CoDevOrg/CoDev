import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/app-chrome";
import { WorkspacePreview } from "@/components/landing-workspace-preview";
import { getCurrentAppUser } from "@/lib/identity";

export const metadata: Metadata = {
  title: "One shared room for your team and AI agents",
  description:
    "See agent work live, run tasks in parallel, review decisions, and hand off from one shared CoDev room.",
};

const capabilities = [
  [
    "01",
    "See the work live",
    "Know who is working on what and what each agent is doing.",
  ],
  [
    "02",
    "Run in parallel",
    "Branch an investigation or task without creating disconnected AI threads.",
  ],
  [
    "03",
    "Keep decisions attached",
    "Record findings, approvals, and decisions next to the work that produced them.",
  ],
  [
    "04",
    "Hand off without a briefing",
    "Anyone joining later gets the current state, not a pasted summary.",
  ],
] as const;

const incidentTimeline = [
  ["2:14 PM", "Checkout failures detected", "Sarah opens a CoDev room."],
  [
    "2:16 PM",
    "Claude checks logs and traces",
    "The first signal is shared with everyone.",
  ],
  [
    "2:17 PM",
    "David starts a database branch",
    "Gemini investigates saturation in parallel.",
  ],
  [
    "2:19 PM",
    "Codex reviews the latest deployment",
    "Alex keeps the rollback path ready.",
  ],
  [
    "2:22 PM",
    "Payment provider ruled out",
    "The finding updates the room for every branch.",
  ],
  [
    "2:25 PM",
    "Connection pool exhaustion identified",
    "The strongest hypothesis becomes shared state.",
  ],
  ["2:27 PM", "Rollback prepared", "Codex finishes the safety review."],
  [
    "2:29 PM",
    "Sarah approves remediation",
    "The decision and owner stay attached.",
  ],
] as const;

const lanes = [
  ["Database", "David", "Gemini", "Running"],
  ["Deployments", "Sarah", "Codex", "Reviewing"],
  ["Provider", "Alex", "Claude", "Complete"],
] as const;

const secondaryUseCases = [
  [
    "Customer escalations",
    "Support and engineering investigate the same customer problem with one shared history.",
  ],
  [
    "Complex deals",
    "Sales, security, legal, and AI work from the same account context.",
  ],
  [
    "Professional services",
    "Agents do the work while the right people review, revise, and approve it.",
  ],
] as const;

export default async function HomePage() {
  if (await getCurrentAppUser()) redirect("/dashboard");

  return (
    <main className="mp-page">
      <header className="mp-nav">
        <Brand />
        <nav aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#use-cases">Use cases</a>
          <Link className="mp-sign-in" href="/sign-in">
            Sign in
          </Link>
          <Link className="mp-nav-cta" href="/sign-in">
            Create a room <span>↗</span>
          </Link>
        </nav>
      </header>

      <section className="mp-hero">
        <div className="mp-hero-copy">
          <p className="mp-eyebrow">
            <i /> MULTIPLAYER AI FOR REAL WORK
          </p>
          <h1>
            One shared room for your team and <em>AI agents.</em>
          </h1>
          <p className="mp-lede">
            Work on the same problem together. See what every agent is doing,
            run work in parallel, share context, review decisions, and hand off
            without starting over.
          </p>
          <div className="mp-hero-actions">
            <Link className="mp-primary-action" href="/sign-in">
              Create a room <span>↗</span>
            </Link>
            <a href="#how-it-works">
              See how it works <span>↓</span>
            </a>
          </div>
          <p className="mp-hero-note">
            Works with Claude, GPT, Gemini, Codex, and your own agents.
          </p>
        </div>
        <WorkspacePreview />
      </section>

      <section className="mp-problem" id="how-it-works">
        <div className="mp-section-heading mp-section-heading-stack">
          <p>TODAY</p>
          <h2>
            Your team is working on the same problem in{" "}
            <em>separate AI sessions.</em>
          </h2>
          <span>
            One person is in Claude. Another is in ChatGPT. Someone else is
            running a coding agent. Useful work gets copied, summarized, and
            lost between sessions.
          </span>
        </div>
        <div
          className="mp-problem-flow"
          aria-label="Separate AI sessions becoming one CoDev room"
        >
          <div className="mp-private-sessions">
            <article>
              <span>S</span>
              <div>
                <b>Sarah · Claude</b>
                <p>Private investigation</p>
              </div>
            </article>
            <article>
              <span>D</span>
              <div>
                <b>David · GPT</b>
                <p>Separate analysis</p>
              </div>
            </article>
            <article>
              <span>A</span>
              <div>
                <b>Alex · Codex</b>
                <p>Local agent run</p>
              </div>
            </article>
          </div>
          <div className="mp-copy-steps">
            <span>↓ copy</span>
            <span>↓ summarize</span>
            <span>↓ paste</span>
            <span>↓ explain again</span>
          </div>
          <div className="mp-shared-state">
            <div className="mp-shared-icon">C</div>
            <div>
              <b>CoDev room</b>
              <p>One room · One history · One shared context</p>
            </div>
            <span>Live</span>
          </div>
        </div>
      </section>

      <section className="mp-product-story">
        <div className="mp-section-heading mp-section-heading-stack">
          <p>HOW CODEV WORKS</p>
          <h2>
            The room is the <em>source of truth.</em>
          </h2>
          <span>
            People, agents, files, tasks, findings, and decisions stay together
            while the work happens.
          </span>
        </div>
        <div className="mp-capability-grid">
          {capabilities.map(([number, title, copy]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mp-action-story">
        <div className="mp-section-heading mp-section-heading-stack">
          <p>SEE IT IN ACTION</p>
          <h2>
            An incident starts. Everyone joins the <em>same investigation.</em>
          </h2>
        </div>
        <div className="mp-timeline">
          {incidentTimeline.map(([time, title, copy]) => (
            <article key={time}>
              <time>{time}</time>
              <i />
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="mp-story-note">
          No private agent sessions. No duplicate investigation. No catch-up
          meeting.
        </p>
      </section>

      <section className="mp-parallel-story">
        <div className="mp-section-heading mp-section-heading-stack">
          <p>WORK IN PARALLEL</p>
          <h2>
            Give every person and agent a <em>clear lane.</em>
          </h2>
          <span>
            Split the problem into branches and keep every result connected to
            the same room.
          </span>
        </div>
        <div className="mp-lane-diagram">
          <div className="mp-lane-root">
            <b>Payments incident</b>
            <span>One shared room</span>
          </div>
          <div className="mp-lanes">
            {lanes.map(([task, person, agent, status]) => (
              <article key={task}>
                <span>{task}</span>
                <h3>{person}</h3>
                <p>{agent}</p>
                <small>{status}</small>
              </article>
            ))}
          </div>
        </div>
        <p className="mp-story-note">
          Everyone can see the other branches. Nothing disappears into a private
          session.
        </p>
      </section>

      <section className="mp-handoff-story">
        <div className="mp-section-heading mp-section-heading-stack">
          <p>PICK UP WHERE THEY LEFT OFF</p>
          <h2>
            Join halfway through and <em>know what is happening.</em>
          </h2>
          <span>
            CoDev keeps the current hypothesis, open tasks, ruled-out ideas,
            artifacts, decisions, and agent activity in one place.
          </span>
        </div>
        <div className="mp-handoff-card">
          <header>
            <span>D</span>
            <div>
              <b>David joined</b>
              <small>Room context synced</small>
            </div>
          </header>
          <div>
            <span>What happened</span>
            <strong>Checkout failures began after deploy 7f3a2c</strong>
          </div>
          <div>
            <span>Current hypothesis</span>
            <strong>DB connection pool exhaustion</strong>
          </div>
          <div>
            <span>Ruled out</span>
            <strong>Payment provider · Redis</strong>
          </div>
          <div>
            <span>In progress</span>
            <strong>Rollback review</strong>
          </div>
          <div>
            <span>Decision</span>
            <strong>Do not roll back until DB confirmation</strong>
          </div>
        </div>
      </section>

      <section className="mp-model-layer">
        <div>
          <p>USE THE RIGHT AGENT</p>
          <h2>
            Claude, GPT, Gemini, Codex. <em>Same room.</em>
          </h2>
          <span>
            Use different models or agents for different parts of the work
            without fragmenting the team&apos;s context.
          </span>
          <small>The room belongs to your team, not to one AI provider.</small>
        </div>
        <div
          className="mp-model-diagram"
          aria-label="AI providers connected to one CoDev room"
        >
          <div className="mp-model-workspace">
            <i>C</i>
            <span>
              <b>CoDev room</b>
              <small>Context · Tasks · History · Decisions</small>
            </span>
          </div>
          <div className="mp-model-line" />
          <div className="mp-models">
            <span>Claude</span>
            <span>GPT</span>
            <span>Gemini</span>
            <span>Codex</span>
            <span>Your agent</span>
          </div>
        </div>
      </section>

      <section className="mp-use-cases" id="use-cases">
        <div className="mp-section-heading mp-section-heading-stack">
          <p>BUILT FOR WORK THAT NEEDS A TEAM</p>
          <h2>
            The same room works wherever humans and agents{" "}
            <em>need to coordinate.</em>
          </h2>
        </div>
        <div className="mp-case-grid mp-secondary-grid">
          {secondaryUseCases.map(([title, copy], index) => (
            <article key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
        <p className="mp-story-note">
          Start with engineering. Expand wherever your team uses AI together.
        </p>
      </section>

      <section className="mp-final-cta">
        <div>
          <p>BRING EVERYONE INTO THE ROOM</p>
          <h2>
            Stop passing AI work around. <em>Work on it together.</em>
          </h2>
          <span>Invite your team. Add your agents. Start working.</span>
        </div>
        <Link className="mp-primary-action mp-primary-light" href="/sign-in">
          Create a room <span>↗</span>
        </Link>
      </section>

      <footer className="mp-footer">
        <Brand />
        <p>One shared room for your team and AI agents.</p>
        <span>Hosted on the web</span>
      </footer>
    </main>
  );
}
