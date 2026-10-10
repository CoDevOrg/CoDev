"use client";

import { ChevronDown, ChevronUp, SquareTerminal, X } from "lucide-react";

import { cn } from "@/lib/platform/utils";
import { Gen2TerminalPane } from "./terminal-pane";
import type { TerminalTailReader } from "./use-workspace-terminal-io";
import {
  MAIN_TERMINAL_TAB,
  type WorkspaceTerminalTab,
} from "./use-workspace-terminal-tabs";
import { WorkspaceButton } from "./workspace-button";

type Shared = {
  workspaceId: string;
  connection: "ready" | "waking" | "asleep" | "blocked";
  onResumeWorkspace: () => Promise<boolean>;
  onTailReader(tabId: string, read: TerminalTailReader | null): void;
};

type WorkspaceTerminalDockProps = Shared & {
  worktreeId: string;
  branch: string;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
  tabs: WorkspaceTerminalTab[];
  activeId: string;
  onSelectTab(id: string): void;
  onCloseTab(id: string): void;
};

function DockBar({
  branch,
  expanded,
  onToggle,
}: {
  branch: string;
  expanded: boolean;
  onToggle(): void;
}) {
  return (
    <div
      className="gen2-ide-terminal-dock-bar"
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onToggle();
      }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse terminal" : "Expand terminal"}
    >
      <div className="gen2-ide-terminal-dock-label">
        <SquareTerminal
          aria-hidden="true"
          className="gen2-ide-terminal-dock-icon"
        />
        <span className="gen2-ide-terminal-dock-title">Terminal</span>
        <span className="gen2-ide-terminal-dock-badge">{branch}</span>
      </div>
      <div className="gen2-ide-terminal-dock-action" aria-hidden="true">
        {expanded ? <ChevronDown /> : <ChevronUp />}
      </div>
    </div>
  );
}

/** One session's panel; it stays mounted while hidden so its process runs on. */
function DockTerminal({
  id,
  worktreeId,
  shown,
  expanded,
  input,
  shared,
}: {
  id: string;
  worktreeId: string;
  shown: boolean;
  expanded: boolean;
  input?: WorkspaceTerminalTab["input"] | undefined;
  shared: Shared;
}) {
  return (
    <div
      id={`gen2-terminal-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`gen2-terminal-tab-${id}`}
      className="gen2-terminal-panel"
      hidden={!shown}
    >
      <Gen2TerminalPane
        workspaceId={shared.workspaceId}
        worktreeId={worktreeId}
        visible={expanded && shown}
        canStart
        autoStart
        workspaceConnection={shared.connection}
        onResumeWorkspace={shared.onResumeWorkspace}
        onExit={() => undefined}
        queuedInput={input}
        onTailReader={(read) => shared.onTailReader(id, read)}
      />
    </div>
  );
}

/**
 * The terminal dock under the chat: the worktree's own shell plus a tab per
 * command the member accepted from an agent. Tabs appear only when there is
 * more than one session. Hidden tabs stay mounted, so their processes keep
 * running; closing a tab ends its session.
 */
export function WorkspaceTerminalDock(props: WorkspaceTerminalDockProps) {
  const { worktreeId, expanded, tabs, activeId } = props;
  const visibleTabs = tabs.filter((tab) => tab.worktreeId === worktreeId);
  return (
    <div
      className={cn(
        "gen2-ide-terminal-dock",
        expanded ? "expanded" : "collapsed",
      )}
      aria-label="Terminal dock"
    >
      <DockBar
        branch={props.branch}
        expanded={expanded}
        onToggle={() => props.onExpandedChange(!expanded)}
      />
      <div className="gen2-ide-terminal-dock-content" hidden={!expanded}>
        {visibleTabs.length ? (
          <TerminalTabList
            tabs={visibleTabs}
            activeId={activeId}
            onSelect={props.onSelectTab}
            onClose={props.onCloseTab}
          />
        ) : null}
        <DockTerminal
          key={worktreeId}
          id={MAIN_TERMINAL_TAB}
          worktreeId={worktreeId}
          shown={activeId === MAIN_TERMINAL_TAB}
          expanded={expanded}
          shared={props}
        />
        {tabs.map((tab) => (
          <DockTerminal
            key={tab.id}
            id={tab.id}
            worktreeId={tab.worktreeId}
            shown={tab.worktreeId === worktreeId && tab.id === activeId}
            expanded={expanded}
            input={tab.input}
            shared={props}
          />
        ))}
      </div>
    </div>
  );
}

function TerminalTabList({
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: WorkspaceTerminalTab[];
  activeId: string;
  onSelect(id: string): void;
  onClose(id: string): void;
}) {
  const tab = (id: string, label: string) => (
    <button
      type="button"
      role="tab"
      id={`gen2-terminal-tab-${id}`}
      aria-controls={`gen2-terminal-panel-${id}`}
      aria-selected={activeId === id}
      className="gen2-terminal-tab-button"
      onClick={() => onSelect(id)}
    >
      {label}
    </button>
  );
  return (
    <div role="tablist" aria-label="Terminals" className="gen2-terminal-tabs">
      <span className="gen2-terminal-tab">
        {tab(MAIN_TERMINAL_TAB, "Shell")}
      </span>
      {tabs.map((entry) => (
        <span
          key={entry.id}
          className="gen2-terminal-tab"
          title={entry.input.text.trim()}
        >
          {tab(entry.id, entry.label)}
          <WorkspaceButton
            size="icon"
            className="gen2-terminal-tab-close"
            aria-label={`Close ${entry.label}`}
            onClick={() => onClose(entry.id)}
          >
            <X aria-hidden="true" />
          </WorkspaceButton>
        </span>
      ))}
    </div>
  );
}
