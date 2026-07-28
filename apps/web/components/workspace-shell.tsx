"use client";

import Link from "next/link";
import { useState } from "react";

type FileItem = {
  readonly name: string;
  readonly kind: string;
  readonly depth: number;
  readonly active?: boolean;
};

type CodeLine = {
  readonly number: number;
  readonly content: string;
};

type Agent = {
  readonly initials: string;
  readonly name: string;
  readonly task: string;
  readonly branch: string;
  readonly state: string;
  readonly tone: string;
};

type TerminalLine = {
  readonly text: string;
  readonly prompt?: boolean;
  readonly kind?: string;
};

type WorkspaceShellProps = {
  files: readonly FileItem[];
  code: readonly CodeLine[];
  agents: readonly Agent[];
  terminalLines: readonly TerminalLine[];
};

function CoDevMark() {
  return (
    <span className="workspace-brand-mark" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function FileIcon({ kind }: { kind: string }) {
  if (kind === "folder") {
    return <span className="file-chevron">⌄</span>;
  }

  const labels: Record<string, string> = {
    tsx: "TS",
    css: "#",
    markdown: "M",
  };

  return (
    <span className={`file-kind file-kind-${kind}`}>{labels[kind] ?? "·"}</span>
  );
}

export function WorkspaceShell({
  files,
  code,
  agents,
  terminalLines,
}: WorkspaceShellProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [worktree, setWorktree] = useState("integration");

  return (
    <main className="workspace-page">
      <header className="workspace-topbar">
        <Link
          className="workspace-brand"
          href="/"
          aria-label="Back to CoDev home"
        >
          <CoDevMark />
          <strong>CoDev</strong>
        </Link>
        <span className="topbar-divider" />
        <div className="repo-crumbs" aria-label="Current repository">
          <span className="github-glyph" aria-hidden="true">
            ◉
          </span>
          <span>yousef20920</span>
          <i>/</i>
          <strong>codev</strong>
        </div>
        <div className="topbar-center">
          <span className="branch-icon" aria-hidden="true">
            ⑂
          </span>
          <select
            aria-label="Active worktree"
            onChange={(event) => setWorktree(event.target.value)}
            value={worktree}
          >
            <option value="integration">integration / main</option>
            <option value="atlas">agent / atlas-shell</option>
            <option value="nova">agent / nova-contracts</option>
          </select>
        </div>
        <div className="topbar-actions">
          <span className="connection-state">
            <i />
            Not connected
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label="Notifications"
          >
            ◌
          </button>
          <span className="user-avatar">YM</span>
        </div>
      </header>

      <div className="demo-banner" role="status">
        <span>Demo shell</span>
        Fixture data only — repositories, terminals, and agents are not
        connected yet.
        <Link href="/">About this preview</Link>
      </div>

      <div
        className={[
          "workspace-grid",
          leftOpen ? "" : "left-collapsed",
          rightOpen ? "" : "right-collapsed",
          terminalOpen ? "" : "terminal-collapsed",
        ].join(" ")}
      >
        <aside className="activity-rail" aria-label="Workspace views">
          <button
            className={leftOpen ? "rail-button active" : "rail-button"}
            type="button"
            aria-label="Toggle file explorer"
            aria-pressed={leftOpen}
            onClick={() => setLeftOpen((open) => !open)}
          >
            ◫
          </button>
          <button className="rail-button" type="button" aria-label="Search">
            ⌕
          </button>
          <button
            className="rail-button"
            type="button"
            aria-label="Source control"
          >
            ⑂
          </button>
          <button
            className={
              rightOpen
                ? "rail-button active agent-rail"
                : "rail-button agent-rail"
            }
            type="button"
            aria-label="Toggle agent activity"
            aria-pressed={rightOpen}
            onClick={() => setRightOpen((open) => !open)}
          >
            ✦
          </button>
          <div className="rail-spacer" />
          <button className="rail-button" type="button" aria-label="Settings">
            ⚙
          </button>
        </aside>

        <aside className="file-sidebar">
          <div className="panel-title">
            <span>Explorer</span>
            <button type="button" aria-label="Explorer actions">
              •••
            </button>
          </div>
          <div className="repository-heading">
            <span>⌄</span>
            <strong>CODEV</strong>
          </div>
          <nav className="file-tree" aria-label="Repository files">
            {files.map((file) => (
              <button
                className={file.active ? "file-row active" : "file-row"}
                key={`${file.depth}-${file.name}`}
                style={{ "--file-depth": file.depth } as React.CSSProperties}
                type="button"
              >
                <FileIcon kind={file.kind} />
                <span>{file.name}</span>
                {file.active ? <i>M</i> : null}
              </button>
            ))}
          </nav>
          <div className="source-control">
            <div>
              <span>›</span>
              <strong>Outline</strong>
            </div>
            <div>
              <span>›</span>
              <strong>Timeline</strong>
            </div>
          </div>
        </aside>

        <section className="editor-area" aria-label="Code editor">
          <div className="editor-tabbar">
            <div className="editor-tab active">
              <span className="tsx-icon">TS</span>
              workspace-shell.tsx
              <i>M</i>
              <button type="button" aria-label="Close file">
                ×
              </button>
            </div>
            <div className="editor-tab">
              <span className="tsx-icon">TS</span>
              activity-panel.tsx
              <button type="button" aria-label="Close file">
                ×
              </button>
            </div>
            <div className="editor-tab-actions">
              <button type="button" aria-label="Split editor">
                ▥
              </button>
              <button type="button" aria-label="Editor actions">
                •••
              </button>
            </div>
          </div>
          <div className="breadcrumb-bar">
            <span>apps</span>
            <i>›</i>
            <span>web</span>
            <i>›</i>
            <span>components</span>
            <i>›</i>
            <strong>workspace-shell.tsx</strong>
          </div>
          <div className="code-editor" aria-label="Fixture TypeScript source">
            {code.map((line) => (
              <div
                className={
                  line.number === 13 || line.number === 14
                    ? "code-row selected"
                    : "code-row"
                }
                key={line.number}
              >
                <span className="line-number">{line.number}</span>
                <code>{line.content || " "}</code>
              </div>
            ))}
          </div>
          <div className="editor-status">
            <div>
              <span>⑂ main*</span>
              <span>↻</span>
              <span>0 errors</span>
              <span>0 warnings</span>
            </div>
            <div>
              <span>Ln 14, Col 48</span>
              <span>Spaces: 2</span>
              <span>UTF-8</span>
              <span>TypeScript React</span>
            </div>
          </div>
        </section>

        <aside className="agent-panel">
          <div className="agent-panel-head">
            <div>
              <span>Agent activity</span>
              <b>2 sessions</b>
            </div>
            <button
              type="button"
              aria-label="Close agent panel"
              onClick={() => setRightOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="agent-empty-notice">
            <span>◌</span>
            <p>
              <strong>Demo activity</strong>
              These sessions are illustrative and cannot make changes.
            </p>
          </div>
          <div className="agent-session-list">
            {agents.map((agent) => (
              <article className="agent-session" key={agent.name}>
                <div className="agent-session-top">
                  <span className={`workspace-agent-avatar ${agent.tone}`}>
                    {agent.initials}
                  </span>
                  <p>
                    <strong>{agent.name}</strong>
                    <span>{agent.task}</span>
                  </p>
                  <span className={`agent-pill ${agent.state.toLowerCase()}`}>
                    {agent.state}
                  </span>
                </div>
                <div className="agent-branch">
                  <span>⑂</span>
                  {agent.branch}
                </div>
                <div className="agent-progress">
                  <div>
                    <span />
                    <span />
                    <span />
                  </div>
                  <small>
                    {agent.state === "Working"
                      ? "Editing component structure"
                      : "Ready for review"}
                  </small>
                </div>
                <div className="agent-session-footer">
                  <span>
                    <b>+{agent.name === "Atlas" ? "148" : "86"}</b>{" "}
                    <i>−{agent.name === "Atlas" ? "23" : "12"}</i>
                  </span>
                  <button type="button" disabled>
                    Open session
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="activity-log">
            <div className="activity-log-title">
              <span>Recent activity</span>
              <button type="button">Clear</button>
            </div>
            <div className="activity-entry">
              <span className="log-icon success">✓</span>
              <p>
                <strong>Contract tests passed</strong>
                <span>Nova · 2m ago</span>
              </p>
            </div>
            <div className="activity-entry">
              <span className="log-icon">↗</span>
              <p>
                <strong>Review requested</strong>
                <span>Atlas · 4m ago</span>
              </p>
            </div>
            <div className="activity-entry">
              <span className="log-icon muted">⑂</span>
              <p>
                <strong>Worktree created</strong>
                <span>System · 11m ago</span>
              </p>
            </div>
          </div>
        </aside>

        <section className="terminal-panel" aria-label="Terminal preview">
          <div className="terminal-head">
            <div>
              <button className="active" type="button">
                Terminal
              </button>
              <button type="button">
                Problems <span>0</span>
              </button>
              <button type="button">Output</button>
            </div>
            <div>
              <span>zsh</span>
              <button type="button" aria-label="New terminal">
                ＋
              </button>
              <button
                type="button"
                aria-label="Toggle terminal"
                onClick={() => setTerminalOpen((open) => !open)}
              >
                {terminalOpen ? "⌄" : "⌃"}
              </button>
            </div>
          </div>
          <div className="terminal-body">
            <div className="terminal-warning">
              <span>○</span>
              <p>
                <strong>Terminal unavailable in demo shell</strong>
                <small>Connection arrives with the Firecracker runtime.</small>
              </p>
            </div>
            {terminalLines.map((line, index) => (
              <p className={line.kind ?? ""} key={`${line.text}-${index}`}>
                {line.prompt ? (
                  <>
                    <span className="terminal-user">codev</span>
                    <span className="terminal-path">~/CoDev</span>
                    <span className="terminal-branch">main*</span>
                    <b>$</b>
                  </>
                ) : null}
                {line.text}
              </p>
            ))}
            <p className="terminal-cursor">
              <span>codev</span>
              <span>~/CoDev</span>
              <span>main*</span>
              <b>$</b>
              <i />
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
