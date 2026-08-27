import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/app-chrome";
import { LandingAudience } from "@/components/landing-audience";
import { getCurrentAppUser } from "@/lib/identity";

export const metadata: Metadata = {
  title: "The shared workspace for humans and AI agents",
  description:
    "Bring your team and AI agents into one live workspace to investigate, build, review, decide, and hand off work without losing context.",
};

const useCases = [
  {
    index: "01",
    title: "Incident response",
    copy: "Engineers and agents investigate logs, code, and deployments in parallel—without duplicating work.",
    meta: "Engineering · Security",
  },
  {
    index: "02",
    title: "Customer escalations",
    copy: "Support and engineering work from the same facts, owners, decisions, and resolution history.",
    meta: "Support · Product",
  },
  {
    index: "03",
    title: "Complex deals",
    copy: "Keep sales, legal, security, and AI aligned around one living customer context.",
    meta: "Sales · Legal · Security",
  },
  {
    index: "04",
    title: "Professional services",
    copy: "Agents do the work while the right people review, approve, and remain accountable.",
    meta: "Accounting · Advisory",
  },
] as const;

function WorkspacePreview() {
  return (
    <div className="mp-workspace" aria-label="A live CoDev incident workspace">
      <div className="mp-workspace-bar">
        <div className="mp-window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span className="mp-room-name">payments-incident</span>
        <div
          className="mp-presence"
          aria-label="Three people and three agents online"
        >
          <span className="mp-avatar mp-avatar-sarah">S</span>
          <span className="mp-avatar mp-avatar-david">D</span>
          <span className="mp-avatar mp-avatar-agent">AI</span>
          <b>+3</b>
        </div>
      </div>

      <div className="mp-workspace-grid">
        <aside className="mp-room-sidebar">
          <div className="mp-sidebar-section">
            <span className="mp-sidebar-label">Workspace</span>
            <b className="is-active">
              <i /> Activity
            </b>
            <b>
              <i /> Investigations <small>3</small>
            </b>
            <b>
              <i /> Decisions <small>2</small>
            </b>
            <b>
              <i /> Artifacts <small>6</small>
            </b>
          </div>
          <div className="mp-sidebar-section mp-room-members">
            <span className="mp-sidebar-label">In this room</span>
            <p>
              <i className="human" /> Sarah <small>Lead</small>
            </p>
            <p>
              <i className="human" /> David <small>DB</small>
            </p>
            <p>
              <i className="agent" /> Claude <small>Running</small>
            </p>
            <p>
              <i className="agent" /> Codex <small>Reviewing</small>
            </p>
          </div>
        </aside>

        <div className="mp-room-main">
          <div className="mp-incident-head">
            <div>
              <span>
                <i /> SEV-1 · Active
              </span>
              <h2>Payment failures after deploy</h2>
            </div>
            <button type="button" tabIndex={-1}>
              Share room
            </button>
          </div>

          <div className="mp-status-strip">
            <div>
              <span>Current hypothesis</span>
              <strong>Connection pool exhaustion</strong>
            </div>
            <div>
              <span>Owner</span>
              <strong>Sarah Kim</strong>
            </div>
            <div>
              <span>Elapsed</span>
              <strong>28 min</strong>
            </div>
          </div>

          <div className="mp-activity">
            <div className="mp-event">
              <span className="mp-event-avatar claude">C</span>
              <div>
                <p>
                  <strong>Claude</strong>
                  <time>2 min ago</time>
                  <em>Analyzing</em>
                </p>
                <span>
                  Found a 4× increase in checkout DB connections after deploy{" "}
                  <code>7f3a2c</code>.
                </span>
                <div className="mp-tool-call">
                  <i /> Queried production logs · 1,284 events
                </div>
              </div>
            </div>

            <div className="mp-branches">
              <div className="mp-branch">
                <i />
                <span>Database</span>
                <strong>David + Gemini</strong>
                <em>Running</em>
              </div>
              <div className="mp-branch">
                <i />
                <span>Recent deploys</span>
                <strong>Sarah + Codex</strong>
                <em>Reviewing</em>
              </div>
              <div className="mp-branch">
                <i />
                <span>Payment provider</span>
                <strong>GPT</strong>
                <em>Waiting</em>
              </div>
            </div>

            <div className="mp-event mp-human-event">
              <span className="mp-event-avatar sarah">S</span>
              <div>
                <p>
                  <strong>Sarah</strong>
                  <time>just now</time>
                </p>
                <span>
                  Codex, review the rollback for data safety. David, keep
                  tracing the pool.
                </span>
              </div>
            </div>

            <div className="mp-decision">
              <i>✓</i>
              <span>
                <strong>Decision recorded</strong>Prepare rollback; wait for
                database confirmation.
              </span>
              <b>Approved by Sarah</b>
            </div>
          </div>
        </div>

        <aside className="mp-context-panel">
          <span className="mp-sidebar-label">Room context</span>
          <div className="mp-context-block">
            <b>Known facts</b>
            <p>
              <i /> Failures began at 14:32
            </p>
            <p>
              <i /> Only checkout is affected
            </p>
          </div>
          <div className="mp-context-block">
            <b>Ruled out</b>
            <p>
              <i className="is-muted" /> Payment provider outage
            </p>
          </div>
          <div className="mp-handoff">
            <span>DL</span>
            <p>
              <strong>David joined</strong>Room context synced
            </p>
            <i>✓</i>
          </div>
        </aside>
      </div>

      <div className="mp-workspace-foot">
        <span>
          <i /> Live shared context
        </span>
        <p>3 people · 3 agents · 1 source of truth</p>
      </div>
    </div>
  );
}

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
            Start a workspace <span>↗</span>
          </Link>
        </nav>
      </header>

      <section className="mp-hero">
        <div className="mp-hero-copy">
          <p className="mp-eyebrow">
            <i /> Multiplayer work, with AI in the room
          </p>
          <h1>
            The shared workspace for <em>humans and AI agents.</em>
          </h1>
          <p className="mp-lede">
            Investigate, build, review, and decide together. Everyone—and every
            agent—works from the same live context.
          </p>
          <div className="mp-hero-actions">
            <Link className="mp-primary-action" href="/sign-in">
              Start a shared workspace <span>↗</span>
            </Link>
            <a href="#how-it-works">
              See how it works <span>↓</span>
            </a>
          </div>
          <p className="mp-hero-note">
            No private AI threads. No context reconstruction.
          </p>
        </div>
        <WorkspacePreview />
      </section>

      <section className="mp-problem" id="how-it-works">
        <div className="mp-section-heading">
          <p>THE PROBLEM</p>
          <h2>
            Your team works together.
            <br />
            <em>Your AI doesn&apos;t.</em>
          </h2>
        </div>
        <div
          className="mp-problem-flow"
          aria-label="From fragmented AI work to one shared workspace"
        >
          <div className="mp-private-sessions">
            <article>
              <span>C</span>
              <div>
                <b>Claude</b>
                <p>Sarah&apos;s private investigation</p>
              </div>
              <em>Hidden</em>
            </article>
            <article>
              <span>G</span>
              <div>
                <b>GPT</b>
                <p>David&apos;s separate analysis</p>
              </div>
              <em>Hidden</em>
            </article>
            <article>
              <span>⌁</span>
              <div>
                <b>Slack</b>
                <p>Partial outputs pasted later</p>
              </div>
              <em>Fragmented</em>
            </article>
          </div>
          <div className="mp-flow-arrow">
            <span>→</span>
            <p>One shared context</p>
          </div>
          <div className="mp-shared-state">
            <div className="mp-shared-icon">C</div>
            <div>
              <b>CoDev workspace</b>
              <p>
                People, agents, tasks, decisions, and history stay connected.
              </p>
            </div>
            <span>Live</span>
          </div>
        </div>
      </section>

      <LandingAudience />

      <section className="mp-use-cases" id="use-cases">
        <div className="mp-section-heading">
          <p>BUILT FOR CONSEQUENCES</p>
          <h2>
            When the work is expensive,
            <br />
            <em>context matters.</em>
          </h2>
        </div>
        <div className="mp-case-grid">
          {useCases.map((item) => (
            <article key={item.index}>
              <span>{item.index}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
              <small>{item.meta}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="mp-model-layer">
        <div>
          <p>ONE COLLABORATION LAYER</p>
          <h2>
            The workspace stays.
            <br />
            <em>The model can change.</em>
          </h2>
          <span>
            Use the right agent for each job without fragmenting the team&apos;s
            work.
          </span>
        </div>
        <div
          className="mp-model-diagram"
          aria-label="AI providers connected to one CoDev workspace"
        >
          <div className="mp-model-workspace">
            <i>C</i>
            <span>
              <b>Shared workspace</b>
              <small>Context · Control · History</small>
            </span>
          </div>
          <div className="mp-model-line" />
          <div className="mp-models">
            <span>Claude</span>
            <span>GPT</span>
            <span>Gemini</span>
            <span>Codex</span>
            <span>Your agents</span>
          </div>
        </div>
      </section>

      <section className="mp-final-cta">
        <div>
          <p>BRING EVERYONE INTO THE ROOM</p>
          <h2>
            One problem. One workspace.
            <br />
            <em>Your whole team—human and AI.</em>
          </h2>
        </div>
        <Link className="mp-primary-action mp-primary-light" href="/sign-in">
          Start a shared workspace <span>↗</span>
        </Link>
      </section>

      <footer className="mp-footer">
        <Brand />
        <p>The shared workspace for humans and AI agents.</p>
        <span>Hosted on the web</span>
      </footer>
    </main>
  );
}
