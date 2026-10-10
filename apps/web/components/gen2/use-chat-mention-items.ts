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

type AgentRun = WorkspaceAgentSources["agentRuns"][number];

/** Runs still starting count as active, as the shell counts them. */
const ACTIVE_RUN = new Set(["running", "creating"]);

function agentRow(run: AgentRun, label: string): ComposerMenuItem {
  const state = run.status === "creating" ? "Starting" : "Running";
  return {
    id: `agent-${run.id}`,
    group: "Chats & agents",
    label,
    detail: run.branch ? `${state} · ${run.branch}` : state,
    icon: "agent",
    provider: run.provider,
    action: mention({ kind: "agent", ref: run.id, label }),
  };
}

function runLabel(run: AgentRun) {
  const name = GEN2_AGENT_PROVIDERS.find(
    (entry) => entry.id === run.provider,
  )?.label;
  return name ? `${name} agent` : "Agent run";
}

/** Other chats, newest first (a running one as its agent), then runs
 *  without a listed chat. This chat and its own run are left out. */
function chatItems(
  context: WorkspaceAgentContextValue,
  chatId: string | null,
  query: string,
) {
  const { chats, agentRuns } = context.sources;
  const matches = (label: string) => label.toLowerCase().includes(query);
  const active = agentRuns.filter(
    (run) =>
      ACTIVE_RUN.has(run.status) &&
      (run.chatId === null || run.chatId !== chatId),
  );
  const listed = new Set(chats.map((chat) => chat.id));
  const chatRows = [...chats]
    .filter((chat) => chat.id !== chatId && matches(chat.title))
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )
    .slice(0, 6)
    .map<ComposerMenuItem>((chat) => {
      const run = active.find((entry) => entry.chatId === chat.id);
      if (run)
        return {
          ...agentRow(run, chat.title),
          id: `chat-${chat.id}`,
          provider: run.provider ?? chat.provider ?? null,
        };
      return {
        id: `chat-${chat.id}`,
        group: "Chats & agents",
        label: chat.title,
        icon: "chat",
        provider: chat.provider ?? null,
        action: mention({ kind: "chat", ref: chat.id, label: chat.title }),
      };
    });
  const loose = active
    .filter((run) => run.chatId === null || !listed.has(run.chatId))
    .map((run) => agentRow(run, runLabel(run)))
    .filter((row) => matches(row.label))
    .slice(0, 4);
  return [...chatRows, ...loose];
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

/** The selection and terminal output as they are when the menu opens. */
function usePinned(open: boolean, sources: WorkspaceAgentSources | null) {
  const [pinned, setPinned] = useState<Pinned>({
    selection: null,
    terminal: null,
  });
  const sourcesRef = useRef(sources);
  useEffect(() => {
    sourcesRef.current = sources;
  });

  useEffect(() => {
    const current = sourcesRef.current;
    if (!open || !current) return;
    current.refreshRuns();
    let live = true;
    void Promise.resolve().then(() => {
      if (live)
        setPinned({
          selection: current.selection(),
          terminal: current.terminalTail(),
        });
    });
    return () => {
      live = false;
    };
  }, [open]);
  return pinned;
}

/**
 * The @ menu: the editor selection and terminal output when there are any,
 * files (this chat's first), other chats and active agents, and per-message
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
  const sources = agentContext?.sources ?? null;
  const files = useComposerFiles(sources, open);
  const pinned = usePinned(open, sources);
  if (!open || !trigger) return [];
  const query = trigger.query.toLowerCase();
  return [
    ...pinnedItems(pinned, query),
    ...fileItems(messages, files, trigger.query),
    ...chatItems(agentContext, chatId, query),
    ...agentItems(agent, connectedProviders, query),
  ];
}
