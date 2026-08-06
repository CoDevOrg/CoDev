"use client";

import type { ReactNode } from "react";
import {
  FileText,
  GitBranch,
  ListTree,
  LoaderCircle,
  MessageSquare,
  PencilLine,
  Split,
  TerminalSquare,
  Wrench,
  XCircle,
  Paperclip,
} from "lucide-react";

import type { ChatActivity, ChatItem } from "@/lib/agent-chat";
import { formatTokenCount } from "@/lib/token-usage";

type MarkdownBlock =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; level: number; text: string }
  | { kind: "unordered-list"; items: string[] }
  | { kind: "ordered-list"; items: string[] }
  | { kind: "code"; code: string; language?: string };

function isBlockStart(line: string) {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    line.startsWith("```")
  );
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```\s*([^\s]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]?.startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        kind: "code",
        code: code.join("\n"),
        ...(fence[1] ? { language: fence[1] } : {}),
      });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "###").length,
        text: heading[2] ?? "",
      });
      index += 1;
      continue;
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      const items = [unordered[1] ?? ""];
      index += 1;
      while (index < lines.length) {
        const next = lines[index]?.match(/^[-*+]\s+(.+)$/);
        if (!next) break;
        items.push(next[1] ?? "");
        index += 1;
      }
      blocks.push({ kind: "unordered-list", items });
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      const items = [ordered[1] ?? ""];
      index += 1;
      while (index < lines.length) {
        const next = lines[index]?.match(/^\d+\.\s+(.+)$/);
        if (!next) break;
        items.push(next[1] ?? "");
        index += 1;
      }
      blocks.push({ kind: "ordered-list", items });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index]?.trim() &&
      !isBlockStart(lines[index] ?? "")
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }

  return blocks;
}

function renderInlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const tokenPattern =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = tokenPattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}:${tokenIndex}`;
    tokenIndex += 1;
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (link) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes;
}

function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className="agent-markdown">
      {parseMarkdownBlocks(text).map((block, index) => {
        const key = `markdown-block:${index}`;
        if (block.kind === "code") {
          return (
            <pre key={key}>
              {block.language ? (
                <span className="agent-markdown-language">
                  {block.language}
                </span>
              ) : null}
              <code>{block.code}</code>
            </pre>
          );
        }
        if (block.kind === "heading") {
          const Heading = `h${block.level}` as
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6";
          return (
            <Heading key={key}>{renderInlineMarkdown(block.text, key)}</Heading>
          );
        }
        if (block.kind === "unordered-list" || block.kind === "ordered-list") {
          const List = block.kind === "unordered-list" ? "ul" : "ol";
          return (
            <List key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}:${itemIndex}`}>
                  {renderInlineMarkdown(item, `${key}:${itemIndex}`)}
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={key}>{renderInlineMarkdown(block.lines.join(" "), key)}</p>
        );
      })}
    </div>
  );
}

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
  canBranch = false,
  branchingTurnId = null,
  onBranchFromReply,
}: {
  items: ChatItem[];
  /** Reserved for live token streaming; unused in M1. */
  streamingText?: string;
  emptyLabel?: string;
  canBranch?: boolean;
  branchingTurnId?: string | null;
  onBranchFromReply?: (turnId: string) => void;
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
              {item.attachments?.length ? (
                <div className="agent-chat-bubble-attachments">
                  {item.attachments.map((attachment) => (
                    <span key={`${item.id}:${attachment.name}`}>
                      <Paperclip aria-hidden="true" />
                      <span>{attachment.name}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }
        if (item.kind === "assistant") {
          const branchBusy = Boolean(
            item.turnId && branchingTurnId === item.turnId,
          );
          return (
            <div className="agent-chat-bubble assistant" key={item.id}>
              <div className="agent-chat-role-row">
                <span className="agent-chat-role">Agent Reply</span>
                {item.tokens ? (
                  <span
                    className="agent-chat-tokens"
                    title={
                      item.tokensEstimated
                        ? "Estimated from reply length"
                        : [
                            item.tokens.inputTokens
                              ? `${formatTokenCount(item.tokens.inputTokens)} input`
                              : null,
                            item.tokens.outputTokens
                              ? `${formatTokenCount(item.tokens.outputTokens)} output`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Model token usage"
                    }
                  >
                    {item.tokensEstimated ? "~" : ""}
                    {formatTokenCount(item.tokens.totalTokens)} tokens
                  </span>
                ) : null}
              </div>
              <AgentMarkdown text={item.text} />
              {canBranch && item.turnId && onBranchFromReply ? (
                <div className="agent-chat-reply-actions">
                  <button
                    type="button"
                    className="agent-chat-branch"
                    disabled={branchBusy || Boolean(branchingTurnId)}
                    onClick={() => onBranchFromReply(item.turnId!)}
                    title="Start a new session from this reply"
                  >
                    <Split aria-hidden="true" />
                    <span>{branchBusy ? "Branching…" : "Branch here"}</span>
                  </button>
                </div>
              ) : null}
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
          <div className="agent-chat-role-row">
            <span className="agent-chat-role">Agent Reply</span>
          </div>
          <AgentMarkdown text={streamingText} />
        </div>
      ) : null}
    </div>
  );
}
