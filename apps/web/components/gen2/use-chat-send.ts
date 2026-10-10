"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  GEN2_AGENT_PROVIDERS,
  type Gen2AgentProviderName,
  type Gen2PossibleDuplicateTask,
} from "@codev/contracts";

import { formatGen2AttachmentPrompt } from "@/lib/gen2/chat-attachments";
import {
  GEN2_PROMPT_COMMANDS,
  parseGen2PromptCommand,
  withGen2PromptCommand,
} from "@/lib/gen2/prompt-command";
import { serializeGen2Mentions } from "@/lib/gen2/prompt-mentions";
import {
  createChat,
  postChatTurn,
  uploadChatAttachments,
  type ChatStartResult,
} from "./chat-turn-client";
import { buildChatTurnContext } from "./chat-turn-context";
import type { StoredChatTurn } from "./chat-turn-storage";
import type { ChatAttachment } from "./use-chat-attachments";
import type { ChatThread } from "./use-chat-thread";
import {
  MAX_PROMPT_CHARS,
  type ComposerMention,
} from "./use-composer-mentions";
import type { WorkspaceAgentContextValue } from "./workspace-controller";

/** Everything one message carries, as the composer held it. */
export type ChatDraft = {
  text: string;
  mentions: ComposerMention[];
  attachments: ChatAttachment[];
  /** Runs this message on another agent without changing the chat's. */
  override: Gen2AgentProviderName | null;
};

type Target = { provider: Gen2AgentProviderName; model: string | undefined };

export type ChatSendInput = {
  workspaceId: string;
  ready: boolean;
  worktreeId?: string | undefined;
  chatId: string | null;
  setChatId: (chatId: string) => void;
  running: boolean;
  /** The provider and model a message runs on, honoring its override. */
  targetFor: (override: Gen2AgentProviderName | null) => Target;
  agentContext: WorkspaceAgentContextValue | null;
  setThread: Dispatch<SetStateAction<ChatThread>>;
  loadThread: (chatId: string) => Promise<void>;
  loadChats: () => Promise<void>;
  follow: (turn: StoredChatTurn) => Promise<void>;
  refreshProvider: () => Promise<void>;
  onNeedsMachine: () => Promise<boolean>;
  onFilesChanged: () => void;
  pinToLatest: () => void;
  setError: (message: string) => void;
  setPossibleDuplicate: (duplicate: Gen2PossibleDuplicateTask | null) => void;
};

/** Mention tokens and the file list can push a full draft past the cap. */
function overLimit(prompt: string) {
  const over = prompt.length - MAX_PROMPT_CHARS;
  return over > 0
    ? `This message is ${over.toLocaleString()} characters too long once its mentions and files are added. Shorten it and try again.`
    : "";
}

/** Why a draft can't go as written, before anything is woken or created. */
function draftProblem({ text, mentions, attachments }: ChatDraft) {
  const parsed = parseGen2PromptCommand(text.trim());
  const command = GEN2_PROMPT_COMMANDS.find(
    (entry) => entry.id === parsed.command,
  );
  if (command?.requiresText && !parsed.text && attachments.length === 0)
    return `Add ${command.argHint} after /${command.id}.`;
  const body = serializeGen2Mentions(parsed.text, mentions);
  return overLimit(withGen2PromptCommand(parsed.command, body));
}

async function wake(input: ChatSendInput, setWaking: (on: boolean) => void) {
  setWaking(true);
  try {
    if (await input.onNeedsMachine()) return true;
  } finally {
    setWaking(false);
  }
  input.setError("Couldn’t reconnect to the workspace. Please try again.");
  return false;
}

/** The prompt as sent: command first, attachment list, mention tokens. */
async function composePrompt(input: ChatSendInput, draft: ChatDraft) {
  const { command, text } = parseGen2PromptCommand(draft.text.trim());
  const body = serializeGen2Mentions(text, draft.mentions);
  if (draft.attachments.length === 0)
    return withGen2PromptCommand(command, body);
  try {
    const files = draft.attachments.map((attachment) => attachment.file);
    const uploaded = await uploadChatAttachments(input.workspaceId, files);
    const prompt = withGen2PromptCommand(
      command,
      formatGen2AttachmentPrompt(uploaded.paths, body),
    );
    if (uploaded.paths.length > 0) input.onFilesChanged();
    const problem = uploaded.error ?? overLimit(prompt);
    if (problem) input.setError(problem);
    return problem ? null : prompt;
  } catch {
    input.setError("Couldn't upload those files. Try again.");
    return null;
  }
}

/** The turn to drive, "goal" for a goal update, or null when none began. */
async function settle(
  input: ChatSendInput,
  result: ChatStartResult,
  chatId: string,
  target: Target,
): Promise<StoredChatTurn | "goal" | null> {
  if (result.kind === "duplicate") {
    input.setPossibleDuplicate(result.duplicate);
    return null;
  }
  if (result.kind === "failed") {
    const label = GEN2_AGENT_PROVIDERS.find(
      (entry) => entry.id === target.provider,
    )?.label;
    input.setError(result.error ?? `${label ?? "The agent"} couldn't start.`);
    if (result.status === 409) void input.refreshProvider();
    return null;
  }
  // A goal update saved the message without running the agent.
  if (result.kind === "goal" || result.fallback) await input.loadThread(chatId);
  if (result.kind === "goal") {
    void input.loadChats();
    return "goal";
  }
  const { sessionId, actionNonce } = result;
  return {
    chatId,
    sessionId,
    after: 0,
    provider: target.provider,
    actionNonce,
  };
}

async function startTurn(
  input: ChatSendInput,
  draft: ChatDraft,
  target: Target,
  options: {
    pendingId: string;
    acknowledged: string | null;
    setWaking: (on: boolean) => void;
  },
) {
  if (!input.ready && !(await wake(input, options.setWaking))) return null;
  const chatId =
    input.chatId ?? (await createChat(input.workspaceId, target.provider))?.id;
  if (!chatId) {
    input.setError("Couldn't start a chat.");
    return null;
  }
  if (chatId !== input.chatId) input.setChatId(chatId);
  const prompt = await composePrompt(input, draft);
  if (prompt === null) return null;
  const message = {
    id: options.pendingId,
    role: "user" as const,
    body: prompt,
    items: null,
    createdAt: new Date().toISOString(),
  };
  input.setThread((current) => ({ messages: [...current.messages, message] }));
  const context = buildChatTurnContext(
    input.agentContext,
    prompt,
    draft.mentions,
  );
  const result = await postChatTurn(input.workspaceId, {
    chatId,
    prompt,
    provider: target.provider,
    idempotencyKey: crypto.randomUUID(),
    ...(input.worktreeId ? { worktreeId: input.worktreeId } : {}),
    ...(target.model ? { model: target.model } : {}),
    ...(options.acknowledged
      ? { acknowledgedDuplicateOf: options.acknowledged }
      : {}),
    ...(context ? { workspaceContext: context } : {}),
  });
  return settle(input, result, chatId, target);
}

/**
 * Starts a turn from a draft: wakes the machine, creates the chat, uploads
 * attachments, then sends the prompt (command first, mentions as tokens)
 * with the workspace snapshot, and drives the turn. Resolves false when no
 * turn started, so the caller can put the draft back.
 */
export function useChatSend(input: ChatSendInput) {
  const [starting, setStarting] = useState(false);
  const [waking, setWaking] = useState(false);
  const sendingRef = useRef(false);
  const acknowledgedRef = useRef<string | null>(null);

  async function send(draft: ChatDraft) {
    const target = input.targetFor(draft.override);
    const empty = !draft.text.trim() && draft.attachments.length === 0;
    const blocked = input.running || starting || sendingRef.current;
    if (empty || blocked || !target.model) return false;
    const problem = draftProblem(draft);
    if (problem) {
      input.setError(problem);
      return false;
    }
    sendingRef.current = true;
    input.pinToLatest();
    setStarting(true);
    input.setError("");
    input.setPossibleDuplicate(null);
    const pendingId = `pending-${crypto.randomUUID()}`;
    const acknowledged = acknowledgedRef.current;
    acknowledgedRef.current = null;
    let turn: StoredChatTurn | "goal" | null = null;
    try {
      turn = await startTurn(input, draft, target, {
        pendingId,
        acknowledged,
        setWaking,
      });
      // The turn owns the busy state from here, so finishing it doesn't
      // fall back to the "Starting…" bubble while the thread reloads.
      setStarting(false);
      if (turn && turn !== "goal") await input.follow(turn);
    } catch {
      input.setError("Couldn't reach CoDev. Try again.");
    } finally {
      if (!turn)
        input.setThread((current) => ({
          messages: current.messages.filter((entry) => entry.id !== pendingId),
        }));
      sendingRef.current = false;
      setStarting(false);
    }
    return turn !== null;
  }

  return {
    starting,
    waking,
    send,
    /** The member chose to start alongside this active run. */
    acknowledgeDuplicate(runId: string) {
      acknowledgedRef.current = runId;
    },
  };
}
