"use client";

import type { ChatItem } from "@/lib/agent-chat";

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
        return (
          <details className="agent-chat-tools" key={item.id}>
            <summary>
              {item.tools.length} tool
              {item.tools.length === 1 ? "" : "s"}
            </summary>
            <ul>
              {item.tools.map((tool) => (
                <li key={tool.id}>
                  <code>{tool.name}</code>
                  <span className={`tool-status ${tool.status}`}>
                    {tool.status}
                  </span>
                  {tool.detail ? <small>{tool.detail}</small> : null}
                </li>
              ))}
            </ul>
          </details>
        );
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
