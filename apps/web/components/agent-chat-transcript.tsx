"use client";

import {
  FileText,
  GitBranch,
  ListTree,
  LoaderCircle,
  MessageSquare,
  PencilLine,
  TerminalSquare,
  Wrench,
  XCircle,
} from "lucide-react";

import type { ChatActivity, ChatItem } from "@/lib/agent-chat";

function ActivityIcon({ activity }: { activity: ChatActivity }) {
  const Icon =
    activity.status === "failed"
      ? XCircle
      : activity.category === "file"
        ? activity.label.includes("Edit")
          ? PencilLine
          : activity.label.includes("Inspect")
            ? ListTree
            : FileText
        : activity.category === "command"
          ? TerminalSquare
          : activity.category === "git"
            ? GitBranch
            : activity.category === "coordination"
              ? MessageSquare
              : Wrench;

  return <Icon aria-hidden="true" />;
}

export function AgentChatTranscript({
  items,
  streamingText,
  emptyLabel = "Start a session to collaborate in the shared chat.",
}: {
  items: ChatItem[];
  /** Reserved for live token streaming; unused in M1. */
  streamingText?: string;
  emptyLabel?: string;
}) {
  const showEmpty = items.length === 0 && !streamingText;

  return (
    <div
      className="agent-chat-transcript"
      aria-live="polite"
      aria-relevant="additions"
    >
      {showEmpty ? <p className="agent-chat-empty">{emptyLabel}</p> : null}
      {items.map((item) => {
        if (item.kind === "user") {
          return (
            <div className="agent-chat-bubble user" key={item.id}>
              <span className="agent-chat-role">You</span>
              <p>{item.text}</p>
            </div>
          );
        }
        if (item.kind === "assistant") {
          return (
            <div className="agent-chat-bubble assistant" key={item.id}>
              <span className="agent-chat-role">Agent</span>
              <p>{item.text}</p>
            </div>
          );
        }
        if (item.kind === "error") {
          return (
            <div className="agent-chat-bubble error" key={item.id} role="alert">
              <span className="agent-chat-role">Error</span>
              <p>{item.text}</p>
            </div>
          );
        }
        if (item.kind === "comment") {
          return (
            <div className="agent-chat-comment" key={item.id}>
              <span className="agent-chat-role">{item.author}</span>
              {item.filePath ? (
                <code>
                  {item.filePath}
                  {item.lineNumber ? `:${item.lineNumber}` : ""}
                </code>
              ) : null}
              <p>{item.text}</p>
            </div>
          );
        }
        if (item.kind === "activities") {
          return (
            <div className="agent-chat-activities" key={item.id}>
              {item.activities.map((activity) => (
                <div
                  className={`agent-chat-activity ${activity.status}`}
                  key={activity.id}
                  aria-label={`${activity.label}${activity.detail ? ` ${activity.detail}` : ""}`}
                  aria-busy={activity.status === "running"}
                >
                  <span className="agent-chat-activity-icon">
                    <ActivityIcon activity={activity} />
                  </span>
                  <span className="agent-chat-activity-copy">
                    <span>{activity.label}</span>
                    {activity.detail ? <code>{activity.detail}</code> : null}
                  </span>
                  {activity.status === "running" ? (
                    <LoaderCircle
                      className="agent-chat-activity-spinner"
                      aria-label="In progress"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          );
        }
        return null;
      })}
      {streamingText ? (
        <div className="agent-chat-bubble assistant streaming">
          <span className="agent-chat-role">Agent</span>
          <p>{streamingText}</p>
        </div>
      ) : null}
    </div>
  );
}
