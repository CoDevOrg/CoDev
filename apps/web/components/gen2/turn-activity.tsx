"use client";

import { useState } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  FileDiff,
  Globe,
  ListChecks,
  Terminal as TerminalIcon,
  Wrench,
} from "lucide-react";
import type { Gen2TurnItem } from "@codev/contracts";

/**
 * What Codex did, as it does it.
 *
 * Every card is keyed by the Codex item id, which is stable from
 * `item.started` through `item.completed`, so a command that streams output
 * updates in place instead of stacking up duplicates.
 */
export function Gen2TurnActivity({
  items,
  onOpenFile,
}: {
  items: Gen2TurnItem[];
  onOpenFile: (path: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="gen2-activity">
      {items.map((item) => (
        <li key={item.id}>
          <ActivityCard item={item} onOpenFile={onOpenFile} />
        </li>
      ))}
    </ul>
  );
}

function ActivityCard({
  item,
  onOpenFile,
}: {
  item: Gen2TurnItem;
  onOpenFile: (path: string) => void;
}) {
  // A finished message is the reply itself; the thread renders that.
  if (item.kind === "message") return null;

  switch (item.kind) {
    case "reasoning":
      return (
        <Collapsible
          icon={<Brain aria-hidden="true" size={13} />}
          label="Thinking"
          status={item.status}
        >
          <p className="gen2-card-reasoning">{item.text}</p>
        </Collapsible>
      );

    case "command":
      return (
        <Collapsible
          icon={<TerminalIcon aria-hidden="true" size={13} />}
          label={<code className="gen2-card-command">{item.command}</code>}
          status={item.status}
          badge={
            item.exitCode === null ? null : (
              <span
                className="gen2-card-exit"
                data-failed={item.exitCode !== 0}
              >
                exit {item.exitCode}
              </span>
            )
          }
        >
          {item.output.trim() ? (
            <pre className="gen2-card-output">{item.output}</pre>
          ) : (
            <p className="gen2-wb-hint">No output.</p>
          )}
        </Collapsible>
      );

    case "fileChange":
      return (
        <div className="gen2-card" data-status={item.status}>
          <div className="gen2-card-head">
            <FileDiff aria-hidden="true" size={13} />
            <span className="gen2-card-label">
              {item.changes.length === 1
                ? "Edited 1 file"
                : `Edited ${item.changes.length} files`}
            </span>
          </div>
          <ul className="gen2-card-files">
            {item.changes.map((change) => (
              <li key={change.path}>
                <button
                  type="button"
                  className="gen2-card-file"
                  onClick={() => onOpenFile(change.path)}
                >
                  <span
                    className="gen2-card-change"
                    data-change={change.change}
                  >
                    {change.change === "add"
                      ? "+"
                      : change.change === "delete"
                        ? "−"
                        : "~"}
                  </span>
                  {change.path}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );

    case "todoList":
      return (
        <div className="gen2-card" data-status={item.status}>
          <div className="gen2-card-head">
            <ListChecks aria-hidden="true" size={13} />
            <span className="gen2-card-label">Plan</span>
          </div>
          <ul className="gen2-card-todos">
            {item.todos.map((todo, index) => (
              <li key={`${index}-${todo.text}`} data-done={todo.completed}>
                {todo.completed ? (
                  <Check aria-hidden="true" size={12} />
                ) : (
                  <span className="gen2-card-todo-dot" aria-hidden="true" />
                )}
                {todo.text}
              </li>
            ))}
          </ul>
        </div>
      );

    case "webSearch":
      return (
        <div className="gen2-card" data-status={item.status}>
          <div className="gen2-card-head">
            <Globe aria-hidden="true" size={13} />
            <span className="gen2-card-label">Searched “{item.query}”</span>
          </div>
        </div>
      );

    case "toolCall":
      return (
        <div className="gen2-card" data-status={item.status}>
          <div className="gen2-card-head">
            <Wrench aria-hidden="true" size={13} />
            <span className="gen2-card-label">
              {item.server}/{item.tool}
            </span>
          </div>
        </div>
      );
  }
}

function Collapsible({
  icon,
  label,
  status,
  badge,
  children,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  status: Gen2TurnItem["status"];
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gen2-card" data-status={status}>
      <button
        type="button"
        className="gen2-card-head gen2-card-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown aria-hidden="true" size={13} />
        ) : (
          <ChevronRight aria-hidden="true" size={13} />
        )}
        {icon}
        <span className="gen2-card-label">{label}</span>
        {badge}
        {status === "running" ? (
          <span className="gen2-card-spinner" aria-label="Running" />
        ) : null}
      </button>
      {open ? <div className="gen2-card-body">{children}</div> : null}
    </div>
  );
}
