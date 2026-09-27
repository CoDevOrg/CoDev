"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Check,
  ChevronRight,
  FileDiff,
  Globe,
  ListChecks,
  Terminal as TerminalIcon,
  Wrench,
} from "lucide-react";
import type { Gen2TurnItem } from "@codev/contracts";

import {
  formatWorkedDuration,
  summarizeGen2Command,
  unwrapShellCommand,
} from "@/lib/gen2/turn-labels";

/**
 * What Codex did — Cursor-style: one muted “Worked for Xs ›” line, expanding
 * into a compact timeline. No bordered command blobs.
 */
export function Gen2TurnActivity({
  items,
  onOpenFile,
  /** True while the turn is still streaming — keeps the timeline open. */
  live = false,
}: {
  items: Gen2TurnItem[];
  onOpenFile: (path: string) => void;
  live?: boolean;
}) {
  const visible = useMemo(
    () => items.filter((item) => item.kind !== "message"),
    [items],
  );
  const itemRunning = visible.some((item) => item.status === "running");
  const active = live || itemRunning;
  const [open, setOpen] = useState(active);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (visible.length === 0) {
      startedAt.current = null;
      setElapsed(0);
      return;
    }
    startedAt.current ??= Date.now();
    if (!active) {
      setElapsed(
        Math.max(0, Math.round((Date.now() - startedAt.current) / 1000)),
      );
      // Done turns collapse to the Cursor-style summary line.
      setOpen(false);
      return;
    }
    setOpen(true);
    const tick = () => {
      if (startedAt.current == null) return;
      setElapsed(
        Math.max(0, Math.round((Date.now() - startedAt.current) / 1000)),
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [visible.length, active]);

  useEffect(() => {
    if (visible.length === 0) {
      setOpen(false);
      startedAt.current = null;
    }
  }, [visible.length]);

  if (visible.length === 0) return null;

  const summary = active
    ? elapsed > 0
      ? `Working · ${elapsed}s`
      : "Working…"
    : formatWorkedDuration(elapsed);

  return (
    <div className="gen2-steps">
      <button
        type="button"
        className="gen2-steps-summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{summary}</span>
        <ChevronRight
          aria-hidden="true"
          size={12}
          className="gen2-steps-chevron"
          data-open={open || undefined}
        />
      </button>

      {open ? (
        <ol className="gen2-steps-list">
          {visible.map((item) => (
            <li key={item.id} data-status={item.status}>
              <StepRow item={item} onOpenFile={onOpenFile} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function StepRow({
  item,
  onOpenFile,
}: {
  item: Gen2TurnItem;
  onOpenFile: (path: string) => void;
}) {
  switch (item.kind) {
    case "message":
      return null;

    case "reasoning":
      return (
        <StepDisclosure
          icon={<Brain aria-hidden="true" size={13} />}
          label={item.status === "running" ? "Thinking" : "Thought"}
          detail={
            item.status === "running" ? "Reasoning…" : "Reasoning complete"
          }
          status={item.status}
        >
          {item.text.trim() ? (
            <p className="gen2-steps-reasoning">{item.text}</p>
          ) : (
            <p className="gen2-steps-detail">No details.</p>
          )}
        </StepDisclosure>
      );

    case "command": {
      const label = summarizeGen2Command(item.command);
      const detail =
        item.status === "running"
          ? "Running…"
          : item.exitCode === null
            ? "Command finished"
            : item.exitCode === 0
              ? "Command completed"
              : `Failed · exit ${item.exitCode}`;
      return (
        <StepDisclosure
          icon={<TerminalIcon aria-hidden="true" size={13} />}
          label={label}
          detail={detail}
          status={item.status}
        >
          <code className="gen2-steps-raw">
            {unwrapShellCommand(item.command)}
          </code>
          {item.output.trim() ? (
            <pre className="gen2-steps-output">{item.output}</pre>
          ) : (
            <p className="gen2-steps-detail">No output.</p>
          )}
        </StepDisclosure>
      );
    }

    case "fileChange":
      return (
        <div className="gen2-steps-row">
          <span className="gen2-steps-icon" aria-hidden="true">
            <FileDiff size={13} />
          </span>
          <div className="gen2-steps-body">
            <p className="gen2-steps-label">
              {item.changes.length === 1
                ? "Edited 1 file"
                : `Edited ${item.changes.length} files`}
            </p>
            <ul className="gen2-steps-files">
              {item.changes.map((change) => (
                <li key={change.path}>
                  <button
                    type="button"
                    className="gen2-steps-file"
                    onClick={() => onOpenFile(change.path)}
                  >
                    <span
                      className="gen2-steps-change"
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
        </div>
      );

    case "todoList":
      return (
        <div className="gen2-steps-row">
          <span className="gen2-steps-icon" aria-hidden="true">
            <ListChecks size={13} />
          </span>
          <div className="gen2-steps-body">
            <p className="gen2-steps-label">Plan</p>
            <ul className="gen2-steps-todos">
              {item.todos.map((todo, index) => (
                <li key={`${index}-${todo.text}`} data-done={todo.completed}>
                  {todo.completed ? (
                    <Check aria-hidden="true" size={12} />
                  ) : (
                    <span className="gen2-steps-todo-dot" aria-hidden="true" />
                  )}
                  {todo.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      );

    case "webSearch":
      return (
        <div className="gen2-steps-row">
          <span className="gen2-steps-icon" aria-hidden="true">
            <Globe size={13} />
          </span>
          <div className="gen2-steps-body">
            <p className="gen2-steps-label">Searched web</p>
            <p className="gen2-steps-detail">“{item.query}”</p>
          </div>
        </div>
      );

    case "toolCall":
      return (
        <div className="gen2-steps-row">
          <span className="gen2-steps-icon" aria-hidden="true">
            <Wrench size={13} />
          </span>
          <div className="gen2-steps-body">
            <p className="gen2-steps-label">
              {item.server}/{item.tool}
            </p>
            <p className="gen2-steps-detail">
              {item.status === "running" ? "Running…" : "Tool finished"}
            </p>
          </div>
        </div>
      );
  }
}

function StepDisclosure({
  icon,
  label,
  detail,
  status,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  status: Gen2TurnItem["status"];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gen2-steps-row" data-status={status}>
      <span className="gen2-steps-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="gen2-steps-body">
        <button
          type="button"
          className="gen2-steps-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="gen2-steps-label">
            {label}
            {status === "running" ? (
              <span className="gen2-steps-pulse" aria-label="Running" />
            ) : null}
          </span>
          <ChevronRight
            aria-hidden="true"
            size={11}
            className="gen2-steps-chevron"
            data-open={open || undefined}
          />
        </button>
        <p className="gen2-steps-detail">{detail}</p>
        {open ? <div className="gen2-steps-expand">{children}</div> : null}
      </div>
    </div>
  );
}
