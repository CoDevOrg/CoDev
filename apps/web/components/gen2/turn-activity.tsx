"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Brain,
  Check,
  ChevronRight,
  Copy,
  FileDiff,
  Globe,
  ListChecks,
  Terminal as TerminalIcon,
  Wrench,
} from "lucide-react";
import type { Gen2TurnItem } from "@codev/contracts";

import { cn } from "@/lib/platform/utils";
import {
  formatWorkedDuration,
  summarizeGen2Command,
  unwrapShellCommand,
} from "@/lib/gen2/turn-labels";
import { WorkspaceButton } from "./workspace-button";

export function Gen2TurnActivity({
  items,
  onOpenFile,
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
  const [openOverride, setOpenOverride] = useState<{
    active: boolean;
    value: boolean;
  } | null>(null);
  const open = openOverride?.active === active ? openOverride.value : active;
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (visible.length === 0) {
      startedAt.current = null;
      return;
    }
    startedAt.current ??= Date.now();
    if (!active) return;
    const id = window.setInterval(() => {
      if (startedAt.current === null) return;
      setElapsed(
        Math.max(0, Math.round((Date.now() - startedAt.current) / 1000)),
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [visible.length, active]);

  if (visible.length === 0) return null;

  const durationText = active
    ? `Working for ${elapsed > 0 ? `${elapsed}s` : "a moment"}`
    : formatWorkedDuration(elapsed);
  const failed = visible.some((item) => item.status === "failed");

  const steps = (
    <ol className="gen2-turn-steps">
      {visible.map((item) => (
        <li key={item.id} data-status={item.status}>
          <StepRow
            item={item}
            onOpenFile={onOpenFile}
            defaultExpanded={item.status === "running"}
          />
        </li>
      ))}
    </ol>
  );

  return (
    <div
      className="gen2-turn"
      data-active={active || undefined}
      data-failed={failed || undefined}
    >
      {active ? (
        <div className="gen2-turn-live-block">
          <p className="gen2-turn-live">{durationText}</p>
          {steps}
        </div>
      ) : (
        <div className="gen2-turn-complete">
          <button
            type="button"
            className="gen2-turn-summary"
            aria-expanded={open}
            onClick={() => setOpenOverride({ active, value: !open })}
          >
            <span>{durationText}</span>
            <ChevronRight
              aria-hidden="true"
              className={cn("gen2-turn-chevron", open && "is-open")}
            />
          </button>
          {open ? steps : null}
        </div>
      )}
    </div>
  );
}

function StepRow({
  item,
  onOpenFile,
  defaultExpanded = false,
}: {
  item: Gen2TurnItem;
  onOpenFile: (path: string) => void;
  defaultExpanded?: boolean;
}) {
  switch (item.kind) {
    case "message":
      return null;

    case "reasoning":
      return (
        <StepDisclosure
          icon={<Brain aria-hidden="true" />}
          label={item.status === "running" ? "Thinking" : "Thought"}
          detail={
            item.status === "running" ? "Reasoning…" : "Reasoning complete"
          }
          status={item.status}
          defaultExpanded={defaultExpanded}
        >
          {item.text.trim() ? (
            <p className="gen2-turn-note">{item.text}</p>
          ) : (
            <p className="gen2-turn-muted">No details.</p>
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
          icon={<TerminalIcon aria-hidden="true" />}
          label={label}
          detail={detail}
          status={item.status}
          defaultExpanded={defaultExpanded}
        >
          <div className="gen2-turn-command">
            <div className="gen2-turn-command-line">
              <code>{unwrapShellCommand(item.command)}</code>
              <CommandCopyButton text={unwrapShellCommand(item.command)} />
            </div>
            {item.output.trim() ? (
              <pre className="gen2-turn-output">{item.output}</pre>
            ) : (
              <p className="gen2-turn-muted">No output.</p>
            )}
          </div>
        </StepDisclosure>
      );
    }

    case "fileChange":
      return (
        <div className="gen2-turn-files">
          <div className="gen2-turn-row">
            <FileDiff aria-hidden="true" />
            <span>
              {item.changes.length === 1
                ? "Edited 1 file"
                : `Edited ${item.changes.length} files`}
            </span>
          </div>
          <ul className="gen2-turn-file-list">
            {item.changes.map((change) => (
              <li key={change.path}>
                <button
                  type="button"
                  className="gen2-turn-file"
                  data-change={change.change}
                  onClick={() => onOpenFile(change.path)}
                >
                  <span className="gen2-turn-file-mark" aria-hidden="true">
                    {change.change === "add"
                      ? "+"
                      : change.change === "delete"
                        ? "−"
                        : "~"}
                  </span>
                  <span className="gen2-turn-file-path">{change.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      );

    case "todoList":
      return (
        <div className="gen2-turn-plan">
          <div className="gen2-turn-row">
            <ListChecks aria-hidden="true" />
            <span>Plan</span>
          </div>
          <ul className="gen2-turn-todos">
            {item.todos.map((todo, index) => (
              <li
                key={`${index}-${todo.text}`}
                data-done={todo.completed}
                className="gen2-turn-todo"
              >
                {todo.completed ? (
                  <Check aria-hidden="true" className="gen2-turn-todo-done" />
                ) : (
                  <span className="gen2-turn-todo-open" aria-hidden="true" />
                )}
                <span>{todo.text}</span>
              </li>
            ))}
          </ul>
        </div>
      );

    case "webSearch":
      return (
        <div className="gen2-turn-row">
          <Globe aria-hidden="true" />
          <span>Searched web: &ldquo;{item.query}&rdquo;</span>
        </div>
      );

    case "toolCall":
      return (
        <div className="gen2-turn-row gen2-turn-tool">
          <Wrench aria-hidden="true" />
          <span>
            {item.server}/{item.tool} ·{" "}
            {item.status === "running" ? "Running…" : "Done"}
          </span>
        </div>
      );
  }
}

function StepDisclosure({
  icon,
  label,
  detail,
  status,
  defaultExpanded = false,
  children,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  status: Gen2TurnItem["status"];
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  return (
    <div className="gen2-turn-step" data-status={status}>
      <button
        type="button"
        className="gen2-turn-step-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span className="gen2-turn-label">{label}</span>
        <span className="gen2-turn-detail">{detail}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn("gen2-turn-chevron", open && "is-open")}
        />
      </button>
      {open ? <div className="gen2-turn-step-body">{children}</div> : null}
    </div>
  );
}

function CommandCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <WorkspaceButton
      size="icon"
      type="button"
      aria-label="Copy command"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </WorkspaceButton>
  );
}
