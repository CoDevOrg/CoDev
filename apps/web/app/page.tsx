import Link from "next/link";

const flow = [
  [
    "01",
    "Open a repository",
    "Bring a GitHub project into a secure browser workspace.",
  ],
  [
    "02",
    "Delegate in parallel",
    "Give focused work to agents running in isolated Git worktrees.",
  ],
  [
    "03",
    "Review together",
    "See edits, collisions, terminal output, and decisions in one place.",
  ],
];

const features = [
  {
    eyebrow: "Shared context",
    title: "One living workspace",
    copy: "Files, diffs, terminal state, and agent activity stay visible to the whole team.",
  },
  {
    eyebrow: "Safe parallelism",
    title: "A worktree for every agent",
    copy: "Agents can explore and implement independently before their changes reach integration.",
  },
  {
    eyebrow: "Human control",
    title: "Review at every boundary",
    copy: "CoDev is designed around explicit handoffs, path claims, and approval—not invisible automation.",
  },
];

function Wordmark() {
  return (
    <Link className="wordmark" href="/" aria-label="CoDev home">
      <span className="wordmark-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span>CoDev</span>
    </Link>
  );
}

export default function HomePage() {
  return (
    <main className="site-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <Wordmark />
        <div className="nav-links">
          <a href="#workflow">Workflow</a>
          <a href="#principles">Principles</a>
          <Link href="/sign-in">Sign in</Link>
          <Link className="nav-cta" href="/workspaces/demo">
            Open demo
          </Link>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-orbit hero-orbit-one" aria-hidden="true" />
        <div className="hero-orbit hero-orbit-two" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="status-dot" />
            Hosted collaborative development
          </p>
          <h1>
            One workspace.
            <br />
            <span>Two kinds of builders.</span>
          </h1>
          <p className="hero-lede">
            CoDev is a browser-based engineering workspace where people and AI
            agents plan, build, and review software side by side.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/workspaces/demo">
              Explore the demo shell
              <span aria-hidden="true">↗</span>
            </Link>
            <a className="text-link" href="#workflow">
              See how it works <span aria-hidden="true">↓</span>
            </a>
          </div>
          <p className="hero-note">
            No download. No local app. Your workspace lives on the web.
          </p>
        </div>

        <div className="hero-console" aria-label="CoDev workspace preview">
          <div className="console-top">
            <div className="console-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="console-path">
              <span>yousef20920</span>
              <b>/</b>
              <strong>codev</strong>
            </div>
            <span className="console-live">Preview</span>
          </div>
          <div className="console-body">
            <div className="console-rail" aria-hidden="true">
              <span className="rail-logo">C</span>
              <span>⌘</span>
              <span>⌕</span>
              <span>⑂</span>
              <span className="rail-bottom">◉</span>
            </div>
            <div className="console-files">
              <p>EXPLORER</p>
              <b>CODEV</b>
              <span>⌄ apps</span>
              <span className="nested">⌄ web</span>
              <span className="nested-2 active-file">page.tsx</span>
              <span className="nested-2">layout.tsx</span>
              <span>› packages</span>
              <span>› services</span>
              <span className="muted-file">README.md</span>
            </div>
            <div className="console-editor">
              <div className="editor-tabs">
                <span className="selected-tab">page.tsx</span>
                <span>workspace.ts</span>
              </div>
              <div className="code-lines" aria-hidden="true">
                <span>
                  <i>1</i>
                  <em>import</em> {"{"} Workspace {"}"} <em>from</em>{" "}
                  <q>&quot;@/codev&quot;</q>;
                </span>
                <span>
                  <i>2</i>
                </span>
                <span>
                  <i>3</i>
                  <em>export default function</em> <strong>Home</strong>() {"{"}
                </span>
                <span>
                  <i>4</i> <em>return</em> (
                </span>
                <span className="highlight">
                  <i>5</i> &lt;<strong>Workspace</strong> mode=
                  <q>&quot;collaborative&quot;</q>&gt;
                </span>
                <span>
                  <i>6</i> &lt;<strong>Human</strong> role=
                  <q>&quot;architect&quot;</q> /&gt;
                </span>
                <span>
                  <i>7</i> &lt;<strong>Agent</strong> role=
                  <q>&quot;builder&quot;</q> /&gt;
                </span>
                <span>
                  <i>8</i> &lt;/<strong>Workspace</strong>&gt;
                </span>
                <span>
                  <i>9</i> );
                </span>
                <span>
                  <i>10</i>
                  {"}"}
                </span>
              </div>
              <div className="editor-terminal">
                <div>
                  <span>TERMINAL</span>
                  <span>OUTPUT</span>
                </div>
                <p>
                  <b>~/codev</b> <em>main</em> $ pnpm test
                </p>
                <p className="success">✓ 12 tests passed</p>
              </div>
            </div>
            <div className="console-agent">
              <div className="agent-head">
                <span>AGENT ACTIVITY</span>
                <b>•••</b>
              </div>
              <div className="agent-row">
                <span className="agent-avatar">A1</span>
                <div>
                  <strong>Atlas</strong>
                  <small>Implementing #42</small>
                </div>
                <span className="agent-state">Working</span>
              </div>
              <div className="agent-card">
                <p>Updating workspace shell</p>
                <span>
                  <b>+148</b> <em>−23</em>
                </span>
                <small>apps/web/components/</small>
              </div>
              <div className="agent-event">
                <span className="event-icon">✓</span>
                <p>
                  <strong>Tests passed</strong>
                  <small>8 seconds ago</small>
                </p>
              </div>
              <div className="agent-event">
                <span className="event-icon pending">↗</span>
                <p>
                  <strong>Review requested</strong>
                  <small>Waiting for you</small>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="signal-strip" aria-label="Product principles">
        <span>Browser native</span>
        <i />
        <span>Human directed</span>
        <i />
        <span>Agent accelerated</span>
        <i />
        <span>Git grounded</span>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-heading">
          <p className="eyebrow">The workflow</p>
          <h2>Parallel work, without losing the plot.</h2>
          <p>
            CoDev gives every contributor a clear lane, then brings the work
            back together where it can be understood.
          </p>
        </div>
        <div className="flow-grid">
          {flow.map(([number, title, copy]) => (
            <article className="flow-card" key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="principles-section" id="principles">
        <div className="principles-intro">
          <p className="eyebrow">Built for the messy middle</p>
          <h2>Software work is collaborative. The tools should be too.</h2>
        </div>
        <div className="feature-list">
          {features.map((feature) => (
            <article key={feature.title}>
              <p>{feature.eyebrow}</p>
              <h3>{feature.title}</h3>
              <span>{feature.copy}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="closing-cta">
        <p className="eyebrow">Phase 1 preview</p>
        <h2>Step into the workspace.</h2>
        <p>
          Explore the fixture shell that sets the visual foundation for CoDev.
          Live repositories and agents arrive in later phases.
        </p>
        <Link className="primary-button" href="/workspaces/demo">
          Launch browser demo <span aria-hidden="true">→</span>
        </Link>
      </section>

      <footer>
        <Wordmark />
        <p>A hosted workspace for people and agents.</p>
        <span>Phase 1 · Foundation</span>
      </footer>
    </main>
  );
}
