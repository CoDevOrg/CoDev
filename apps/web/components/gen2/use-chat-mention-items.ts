"use client";

import { useEffect, useRef, useState } from "react";
import {
  GEN2_AGENT_PROVIDERS,
  gen2RelativePathSchema,
  type Gen2AgentProviderName,
  type Gen2ChatMessage,
} from "@codev/contracts";

import { matchComposerFiles } from "./chat-file-match";
import { useComposerFiles } from "./use-composer-files";
import type { ComposerMention } from "./use-composer-mentions";
import type {
  ComposerMenuItem,
  ComposerTrigger,
} from "./use-composer-typeahead";
import type {
  WorkspaceAgentContextValue,
  WorkspaceAgentSources,
} from "./workspace-controller";

type Pinned = {
  selection: ReturnType<WorkspaceAgentSources["selection"]>;
  terminal: ReturnType<WorkspaceAgentSources["terminalTail"]>;
};

const mention = (value: ComposerMention) =>
  ({ type: "mention", mention: value }) as const;

function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function pinnedItems({ selection, terminal }: Pinned, query: string) {
  const items: ComposerMenuItem[] = [];
  if (selection) {
    const label = `${basename(selection.path)}:${selection.startLine}-${selection.endLine}`;
    const ref = `${selection.path}#L${selection.startLine}-${selection.endLine}`;
    items.push({
      id: "selection",
      group: "Context",
      label: `Selection (${label})`,
      icon: "selection",
      action: mention({
        kind: "selection",
        ref,
        label,
        excerpt: selection.text,
      }),
    });
  }
  if (terminal)
    items.push({
      id: "terminal",
      group: "Context",
      label: "Terminal output",
      icon: "terminal",
      action: mention({
        kind: "terminal",
        ref: terminal.worktreeId,
        label: "terminal",
        excerpt: terminal.text,
      }),
    });
  return items.filter((item) => item.label.toLowerCase().includes(query));
}

/** Files this chat's agent touched, newest first. */
function touchedFiles(messages: Gen2ChatMessage[]) {
  const paths = messages
    .flatMap((message) => message.items ?? [])
    .flatMap((item) => (item.kind === "fileChange" ? item.changes : []))
    .map((change) => change.path)
    .reverse();
  return [...new Set(paths)]
    .filter((path) => gen2RelativePathSchema.safeParse(path).success)
    .map((path) => ({ path, kind: "file" as const, size: 0 }));
}

function fileItems(
  messages: Gen2ChatMessage[],
  entries: ReturnType<typeof useComposerFiles>,
  query: string,
): ComposerMenuItem[] {
  const touched = touchedFiles(messages);
  const known = new Set(touched.map((entry) => entry.path));
  const listed = (entries.entries ?? []).filter(
    (entry) => !known.has(entry.path),
  );
  const matches = [
    ...matchComposerFiles(touched, query, 4),
    ...matchComposerFiles(listed, query, 8),
  ].slice(0, 8);
  const items = matches.map<ComposerMenuItem>((entry) => ({
    id: `file-${entry.path}`,
    group: "Files",
    label: entry.path,
    detail: known.has(entry.path) ? "Changed in this chat" : undefined,
    icon: entry.kind === "directory" ? "dir" : "file",
    action: mention({
      kind: entry.kind === "directory" ? "dir" : "file",
      ref: entry.path,
      label: entry.path,
    }),
  }));
  const typedPath =
    entries.status === "unavailable" &&
    query &&
    gen2RelativePathSchema.safeParse(query).success;
  return typedPath
    ? [
        ...items,
        {
          id: "file-typed",
          group: "Files",
          label: `Mention ${query} as a path`,
          icon: "file",
          action: mention({ kind: "file", ref: query, label: query }),
        },
      ]
    : items;
}

function chatItems(
  context: WorkspaceAgentContextValue,
  chatId: string | null,
  query: string,
) {
  const { chats, agentRuns } = context.sources;
  const running = (id: string) =>
    agentRuns.find((run) => run.chatId === id && run.status === "running");
  return [...chats]
    .filter(
      (chat) => chat.id !== chatId && chat.title.toLowerCase().includes(query),
    )
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )
    .slice(0, 6)
    .map<ComposerMenuItem>((chat) => {
      const run = running(chat.id);
      return {
        id: `chat-${chat.id}`,
        group: "Chats & agents",
        label: chat.title,
        detail: run
          ? `Running${run.branch ? ` · ${run.branch}` : ""}`
          : undefined,
        icon: run ? "agent" : "chat",
        provider: run?.provider ?? chat.provider ?? null,
        action: mention(
          run
            ? { kind: "agent", ref: run.id, label: chat.title }
            : { kind: "chat", ref: chat.id, label: chat.title },
        ),
      };
    });
}

function agentItems(
  agent: Gen2AgentProviderName,
  connected: Gen2AgentProviderName[],
  query: string,
) {
  return GEN2_AGENT_PROVIDERS.filter(
    (entry) =>
      entry.id !== agent && entry.label.toLowerCase().startsWith(query),
  ).map<ComposerMenuItem>((entry) =>
    connected.includes(entry.id)
      ? {
          id: `use-${entry.id}`,
          group: "Agents",
          label: `Use ${entry.label} for this message`,
          icon: "provider",
          provider: entry.id,
          action: { type: "override", provider: entry.id },
        }
      : {
          id: `connect-${entry.id}`,
          group: "Agents",
          label: `Connect ${entry.label}…`,
          icon: "provider",
          provider: entry.id,
          action: { type: "connect", provider: entry.id },
        },
  );
}

/**
 * The @ menu: the editor selection and terminal output when there are any,
 * files (this chat's first), other chats and running agents, and per-message
 * agent switches. Outside the workspace shell it offers nothing.
 */
export function useChatMentionItems({
  trigger,
  agentContext,
  chatId,
  messages,
  agent,
  connectedProviders,
}: {
  trigger: ComposerTrigger | null;
  agentContext: WorkspaceAgentContextValue | null;
  chatId: string | null;
  messages: Gen2ChatMessage[];
  agent: Gen2AgentProviderName;
  connectedProviders: Gen2AgentProviderName[];
}): ComposerMenuItem[] {
  const open = trigger?.kind === "mention" && agentContext !== null;
  const files = useComposerFiles(agentContext?.sources ?? null, open);
  const [pinned, setPinned] = useState<Pinned>({
    selection: null,
    terminal: null,
  });
  const sourcesRef = useRef(agentContext?.sources ?? null);
  useEffect(() => {
    sourcesRef.current = agentContext?.sources ?? null;
  });

  useEffect(() => {
    const sources = sourcesRef.current;
    if (!open || !sources) return;
    sources.refreshRuns();
    let live = true;
    // Read when the menu opens, so the rows match what the member sees now.
    void Promise.resolve().then(() => {
      if (live)
        setPinned({
          selection: sources.selection(),
          terminal: sources.terminalTail(),
        });
    });
    return () => {
      live = false;
    };
  }, [open]);

  if (!open || !trigger) return [];
  const query = trigger.query.toLowerCase();
  return [
    ...pinnedItems(pinned, query),
    ...fileItems(messages, files, trigger.query),
    ...chatItems(agentContext, chatId, query),
    ...agentItems(agent, connectedProviders, query),
  ];
}
