"use client";

/**
 * Hosted adaptation of Orca's renderer chrome.
 *
 * Derived from stablyai/orca's SidebarNav, SidebarHeader, AgentStateDot, and
 * titlebar composition at upstream commit 6da7b8e9cfe62e5b4d34bb52e8c570036c1935fc.
 * Orca is MIT licensed; attribution lives in third_party/orca/.
 */
import { useState, type ReactNode } from "react";
import {
  Bot,
  Boxes,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  Code2,
  Files,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  MessageCircleQuestion,
  PanelLeftClose,
  Play,
  Plus,
  Search,
  Settings,
  Smartphone,
  TerminalSquare,
} from "lucide-react";

import type { AgentSession } from "@/components/agent-panel";

export type OrcaSurface = "agent" | "code" | "preview" | "stats";

function OrcaMark() {
  return (
    <svg
      className="orca-mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
    >
      <path
        d="M4 14.7c2.5-5.6 6.7-8.8 13.7-9.4-1.2 1.5-1.8 3-1.8 4.5 0 3.3 2.3 5.2 4.1 6.1-2.1 2-4.9 3-8.3 3-3.2 0-5.8-1.4-7.7-4.2Z"
        fill="currentColor"
      />
      <circle cx="14.3" cy="9.2" r="1" fill="var(--orca-editor)" />
    </svg>
  );
}

function sessionState(session: AgentSession) {
  if (session.status === "running" || session.status === "queued") {
    return "working";
  }
  if (session.status === "waiting") return "waiting";
  if (session.status === "failed" || session.lastError) return "failed";
  if (session.worktreeStatus === "merged") return "done";
  return "idle";
}

function AgentStateDot({ session }: { session: AgentSession }) {
  const state = sessionState(session);
  if (state === "done") {
    return <CircleCheck className="orca-state-icon done" aria-label="Done" />;
  }
  if (state === "waiting") {
    return (
      <MessageCircleQuestion
        className="orca-state-icon waiting"
        aria-label="Waiting for input"
      />
    );
  }
  return (
    <span
      className={`orca-state-dot ${state}`}
      aria-label={state === "working" ? "Working" : state}
    />
  );
}

function selectSession(sessionId: string) {
  window.dispatchEvent(
    new CustomEvent("codev:orca-select-session", { detail: { sessionId } }),
  );
}

function startSession() {
  window.dispatchEvent(new CustomEvent("codev:orca-new-session"));
}

export function OrcaHostedTitlebar({
  repository,
  branch,
  surface,
  onSurfaceChange,
  terminalOpen,
  onTerminalToggle,
}: {
  repository: string;
  branch: string;
  surface: OrcaSurface;
  onSurfaceChange: (surface: OrcaSurface) => void;
  terminalOpen: boolean;
  onTerminalToggle: () => void;
}) {
  const project = repository.split("/").at(-1) || "workspace";
  return (
    <header className="orca-titlebar">
      <div className="orca-titlebar-brand">
        <OrcaMark />
        <strong>Orca</strong>
        <button type="button" aria-label="Hide workspace sidebar">
          <PanelLeftClose />
        </button>
      </div>
      <div
        className="orca-title-tabs"
        role="tablist"
        aria-label="Workspace panes"
      >
        <button
          type="button"
          className={surface === "agent" ? "active" : ""}
          onClick={() => onSurfaceChange("agent")}
          role="tab"
          aria-selected={surface === "agent"}
        >
          <Bot />
          Agent
        </button>
        <button
          type="button"
          className={surface === "code" ? "active" : ""}
          onClick={() => onSurfaceChange("code")}
          role="tab"
          aria-selected={surface === "code"}
        >
          <Code2 />
          Code
        </button>
        <button
          type="button"
          className={terminalOpen ? "active" : ""}
          onClick={onTerminalToggle}
          role="tab"
          aria-selected={terminalOpen}
        >
          <TerminalSquare />
          Terminal
        </button>
        <button
          type="button"
          className={surface === "preview" ? "active" : ""}
          onClick={() => onSurfaceChange("preview")}
          role="tab"
          aria-selected={surface === "preview"}
        >
          <Play />
          Preview
        </button>
      </div>
      <div className="orca-titlebar-context">
        <span className="orca-run-target">
          <Play /> {branch} <ChevronDown />
        </span>
        <span className="orca-project-name">{project}</span>
      </div>
    </header>
  );
}

export function OrcaHostedSidebar({
  sessions,
  repository,
  branch,
  canCreate,
}: {
  sessions: AgentSession[];
  repository: string;
  branch: string;
  canCreate: boolean;
}) {
  const active = sessions.filter((session) =>
    ["queued", "running", "waiting"].includes(session.status),
  );
  const review = sessions.filter(
    (session) =>
      !active.includes(session) && session.worktreeStatus === "active",
  );
  const completed = sessions.filter(
    (session) =>
      session.worktreeStatus === "merged" ||
      session.worktreeStatus === "discarded",
  );
  const groups = [
    ["In progress", active],
    ["Review", review],
    ["Completed", completed],
  ] as const;

  return (
    <aside className="orca-fleet-sidebar" aria-label="Orca workspaces">
      <nav className="orca-sidebar-nav" aria-label="Orca navigation">
        <button type="button">
          <LayoutDashboard /> Tasks
        </button>
        <button type="button">
          <CalendarClock /> Automations
        </button>
        <button type="button">
          <Smartphone /> Orca Mobile
        </button>
        <button type="button">
          <Search /> Search
        </button>
      </nav>
      <div className="orca-sidebar-section-head">
        <span>Workspaces</span>
        <div>
          <button type="button" aria-label="Workspace board">
            <Boxes />
          </button>
          <button
            type="button"
            aria-label="New workspace"
            disabled={!canCreate}
            onClick={startSession}
          >
            <Plus />
          </button>
        </div>
      </div>
      <div className="orca-worktree-scroll">
        <div className="orca-primary-worktree">
          <span className="orca-state-dot active" />
          <div>
            <strong>main</strong>
            <small>{branch}</small>
          </div>
          <span className="orca-badge">primary</span>
        </div>
        {groups.map(([label, group]) =>
          group.length ? (
            <section className="orca-worktree-group" key={label}>
              <header>
                <span>{label}</span>
                <b>{group.length}</b>
              </header>
              {group.map((session) => (
                <button
                  className="orca-worktree-card"
                  type="button"
                  key={session.id}
                  onClick={() => selectSession(session.id)}
                >
                  <AgentStateDot session={session} />
                  <span className="orca-worktree-card-copy">
                    <strong>{session.name}</strong>
                    <small>
                      <GitBranch /> {session.worktreeName || branch}
                    </small>
                    <em>
                      <Bot /> {session.provider || "Codex"} · {session.model}
                    </em>
                  </span>
                  {session.reviewHeadSha ? (
                    <GitPullRequest className="orca-pr-icon" />
                  ) : null}
                </button>
              ))}
            </section>
          ) : null,
        )}
        {!sessions.length ? (
          <div className="orca-empty-fleet">
            <Bot />
            <strong>No agent worktrees</strong>
            <span>Start an agent to create an isolated worktree.</span>
          </div>
        ) : null}
      </div>
      <div className="orca-sidebar-project" title={repository}>
        <GitBranch />
        <span>{repository || "No repository"}</span>
      </div>
      <div className="orca-sidebar-footer">
        <button type="button" aria-label="Help">
          ?
        </button>
        <span />
        <button type="button" aria-label="Settings">
          <Settings />
        </button>
      </div>
    </aside>
  );
}

export function OrcaHostedInspector({
  children,
  sourceControl,
  agents,
}: {
  children: ReactNode;
  sourceControl?: ReactNode;
  agents?: ReactNode;
}) {
  const [tab, setTab] = useState<"files" | "source" | "agents">("files");
  return (
    <aside className="orca-inspector" aria-label="Workspace inspector">
      <header>
        <button
          type="button"
          className={tab === "files" ? "active" : ""}
          onClick={() => setTab("files")}
        >
          <Files /> Files
        </button>
        <button
          type="button"
          className={tab === "source" ? "active" : ""}
          onClick={() => setTab("source")}
        >
          <GitBranch /> Source control
        </button>
        <button
          type="button"
          className={tab === "agents" ? "active" : ""}
          onClick={() => setTab("agents")}
        >
          <Bot /> Agents
        </button>
      </header>
      <div className="orca-inspector-body">
        {tab === "files" ? children : tab === "source" ? sourceControl : agents}
      </div>
    </aside>
  );
}

export function OrcaHostedStatusbar({
  branch,
  runtimeReady,
  peopleHere,
  sessions,
}: {
  branch: string;
  runtimeReady: boolean;
  peopleHere: number;
  sessions: AgentSession[];
}) {
  const running = sessions.filter((session) =>
    ["queued", "running", "waiting"].includes(session.status),
  ).length;
  return (
    <footer className="orca-statusbar">
      <span>
        <GitBranch /> {branch}
      </span>
      <span className={runtimeReady ? "online" : "offline"}>
        <i /> {runtimeReady ? "Firecracker connected" : "Runtime offline"}
      </span>
      <span>{running}/3 agents active</span>
      <span className="orca-status-spacer" />
      <span>
        {peopleHere} collaborator{peopleHere === 1 ? "" : "s"}
      </span>
      <span>CoDev host adapter</span>
    </footer>
  );
}
