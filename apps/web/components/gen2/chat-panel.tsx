"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Paperclip,
  Plus,
  Square,
  X,
} from "lucide-react";
import {
  GEN2_AGENT_PROVIDERS,
  type Gen2Chat,
  type Gen2ChatDetail,
  type Gen2ChatMessage,
  type Gen2TurnItem,
  type Gen2WorkspaceDetail,
} from "@codev/contracts";

import { MarkdownContent } from "@/components/markdown/markdown-content";
import { cn } from "@/lib/platform/utils";
import { canRunGen2Agent } from "@/lib/gen2/agent-policy";
import {
  formatGen2AttachmentPrompt,
  gen2ChatUploadPath,
  isNonTextFileContents,
  MAX_GEN2_CHAT_ATTACHMENT_BYTES,
  MAX_GEN2_CHAT_ATTACHMENTS,
} from "@/lib/gen2/chat-attachments";
import {
  decodeAgentExecOutput,
  mergeAgentExecChunks,
  type AgentExecChunk,
} from "@/lib/gen2/agent-output";
import { finalizeGen2Turn, reduceGen2Turn } from "@/lib/gen2/turn-reducer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Gen2ConnectProvider,
  useGen2ProviderStatus,
  type Gen2AgentChoice,
} from "./connect-provider";
import { Gen2TurnActivity } from "./turn-activity";
import { useGen2ChatScroll } from "./use-gen2-chat-scroll";
import { WorkspaceButton } from "./workspace-button";

type Thread = { messages: Gen2ChatMessage[] };
type PendingFile = { id: string; file: File };

const STORAGE_PREFIX = "codev-gen2-turn:";

const SUGGESTIONS = [
  {
    title: "Scaffold Next.js App",
    desc: "Create a modern Next.js project with Tailwind and App Router",
    prompt: "Scaffold a small Next.js app",
  },
  {
    title: "Python with Tests",
    desc: "Set up a clean Python module with pytest and type hints",
    prompt: "Set up a Python project with tests",
  },
  {
    title: "Inspect Environment",
    desc: "Explore this workspace’s files, tools, and Git status",
    prompt: "Show me what's on this machine",
  },
];

function storedTurn(workspaceId: string) {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + workspaceId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      chatId: string;
      sessionId: string;
      after: number;
      provider: Gen2AgentChoice;
    };
    return parsed.chatId &&
      parsed.sessionId &&
      GEN2_AGENT_PROVIDERS.some((entry) => entry.id === parsed.provider)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function rememberTurn(
  workspaceId: string,
  turn: {
    chatId: string;
    sessionId: string;
    after: number;
    provider: Gen2AgentChoice;
  } | null,
) {
  try {
    if (turn) {
      sessionStorage.setItem(
        STORAGE_PREFIX + workspaceId,
        JSON.stringify(turn),
      );
    } else {
      sessionStorage.removeItem(STORAGE_PREFIX + workspaceId);
    }
  } catch {
    /* Private mode; the turn still runs in this tab. */
  }
}

export function Gen2ChatPanel({
  workspace,
  onRunningChange,
  onFilesChanged,
  onOpenFile,
  onNeedsMachine,
  worktreeId,
  activeChatId,
  onSelectChatId,
  onChatsChange,
  activeProvider,
  onActiveProviderChange,
  hideChatBar = false,
}: {
  workspace: Gen2WorkspaceDetail;
  onRunningChange: (running: boolean) => void;
  onFilesChanged: () => void;
  onOpenFile: (path: string) => void;
  /** Brings the machine up; resolves false if it could not. */
  onNeedsMachine: () => Promise<boolean>;
  worktreeId?: string;
  activeChatId?: string | null;
  onSelectChatId?: (chatId: string) => void;
  onChatsChange?: (chats: Gen2Chat[]) => void;
  activeProvider?: Gen2AgentChoice;
  onActiveProviderChange?: (provider: Gen2AgentChoice) => void;
  hideChatBar?: boolean;
}) {
  const [chats, setChats] = useState<Gen2Chat[]>([]);
  const [chatId, setChatId] = useState<string | null>(activeChatId ?? null);
  const [thread, setThread] = useState<Thread>({ messages: [] });
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [items, setItems] = useState<Gen2TurnItem[]>([]);
  const [liveReply, setLiveReply] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sendingRef = useRef(false);
  const drivingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragDepthRef = useRef(0);
  const attachInputId = useId();
  const [waking, setWaking] = useState(false);
  const [agent, setAgent] = useState<Gen2AgentChoice>(
    activeProvider ?? GEN2_AGENT_PROVIDERS[0].id,
  );
  const agentLabel =
    GEN2_AGENT_PROVIDERS.find((entry) => entry.id === agent)?.label ?? "Agent";
  const { status: provider, refresh: refreshProvider } =
    useGen2ProviderStatus(agent);
  const ready = canRunGen2Agent(workspace.status);
  const busy = running || starting || waking;
  const canSend = Boolean(prompt.trim() || attachments.length > 0) && !busy;
  const empty = thread.messages.length === 0 && !running;
  const contentKey = `${chatId ?? ""}:${thread.messages.length}:${items.length}:${liveReply.length}`;
  const { onScroll, showJump, jumpToLatest, pinToLatest } = useGen2ChatScroll(
    transcriptRef,
    contentKey,
  );

  useEffect(() => {
    if (activeChatId && activeChatId !== chatId) {
      setChatId(activeChatId);
    }
  }, [activeChatId, chatId]);

  useEffect(() => {
    if (activeProvider && activeProvider !== agent) {
      setAgent(activeProvider);
    }
  }, [activeProvider, agent]);

  useEffect(() => {
    pinToLatest();
  }, [chatId, pinToLatest]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(
    () => onRunningChange(running || starting),
    [running, starting, onRunningChange],
  );

  const loadChats = useCallback(async () => {
    const response = await fetch(`/api/gen2/workspaces/${workspace.id}/chats`);
    if (!response.ok) return;
    const payload = (await response.json()) as { chats?: Gen2Chat[] };
    const fetchedChats = payload.chats ?? [];
    setChats(fetchedChats);
    onChatsChange?.(fetchedChats);
    const targetId = activeChatId ?? fetchedChats[0]?.id ?? null;
    setChatId((current) => current ?? targetId);
    if (targetId && !activeChatId) {
      onSelectChatId?.(targetId);
    }
  }, [workspace.id, activeChatId, onChatsChange, onSelectChatId]);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  const loadThread = useCallback(
    async (id: string) => {
      const response = await fetch(
        `/api/gen2/workspaces/${workspace.id}/chats/${id}`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { chat?: Gen2ChatDetail };
      setThread({ messages: payload.chat?.messages ?? [] });
    },
    [workspace.id],
  );

  useEffect(() => {
    if (!chatId) {
      setThread({ messages: [] });
      return;
    }
    void loadThread(chatId);
  }, [chatId, loadThread]);

  /** Drives one turn to completion, re-reducing the stream on every poll. */
  const drive = useCallback(
    async (
      session: string,
      chat: string,
      startAfter: number,
      turnProvider: Gen2AgentChoice,
    ) => {
      if (drivingRef.current) return;
      drivingRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      sessionRef.current = session;
      setRunning(true);
      let chunks: AgentExecChunk[] = [];
      let after = startAfter;
      let sawFileChange = false;

      try {
        for (;;) {
          const response = await fetch(
            `/api/gen2/workspaces/${workspace.id}/agent/poll`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId: chat, sessionId: session, after }),
              signal: controller.signal,
            },
          );
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(payload.error ?? "That turn could not continue.");
          }
          const payload = (await response.json()) as {
            chunks?: AgentExecChunk[];
            nextSequence?: number;
            exited?: boolean;
            exitCode?: number | null;
          };
          chunks = mergeAgentExecChunks(
            chunks,
            Array.isArray(payload.chunks) ? payload.chunks : [],
          );
          after = payload.nextSequence ?? after;
          rememberTurn(workspace.id, {
            chatId: chat,
            sessionId: session,
            after,
            provider: turnProvider,
          });

          const output = decodeAgentExecOutput(chunks);
          const state = payload.exited
            ? finalizeGen2Turn(
                turnProvider,
                reduceGen2Turn(turnProvider, output),
                payload.exitCode ?? null,
              )
            : reduceGen2Turn(turnProvider, output);
          setItems(state.items);
          setLiveReply(state.reply);
          if (state.items.some((item) => item.kind === "fileChange")) {
            sawFileChange = true;
          }

          if (payload.exited) {
            if (state.error) setError(state.error);
            break;
          }
        }
      } catch (cause) {
        if ((cause as Error)?.name !== "AbortError") {
          setError(
            cause instanceof Error ? cause.message : "That turn stopped.",
          );
          void refreshProvider();
        }
      } finally {
        drivingRef.current = false;
        abortRef.current = null;
        sessionRef.current = null;
        rememberTurn(workspace.id, null);
        setRunning(false);
        setItems([]);
        setLiveReply("");
        await loadThread(chat);
        await loadChats();
        if (sawFileChange) onFilesChanged();
      }
    },
    [workspace.id, loadThread, loadChats, onFilesChanged, refreshProvider],
  );

  // Rejoin a turn that was still running when the page reloaded.
  useEffect(() => {
    const stored = storedTurn(workspace.id);
    if (!stored) return;
    setChatId(stored.chatId);
    void drive(stored.sessionId, stored.chatId, stored.after, stored.provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  function queueFiles(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    setError("");
    setAttachments((current) => {
      const room = MAX_GEN2_CHAT_ATTACHMENTS - current.length;
      if (room <= 0) {
        setError(`You can attach up to ${MAX_GEN2_CHAT_ATTACHMENTS} files.`);
        return current;
      }
      const next = [...current];
      for (const file of incoming.slice(0, room)) {
        if (file.size > MAX_GEN2_CHAT_ATTACHMENT_BYTES) {
          setError(`${file.name} is larger than 1 MB.`);
          continue;
        }
        next.push({ id: crypto.randomUUID(), file });
      }
      if (incoming.length > room) {
        setError(`You can attach up to ${MAX_GEN2_CHAT_ATTACHMENTS} files.`);
      }
      return next;
    });
  }

  async function uploadAttachments(
    pending: PendingFile[],
  ): Promise<{ paths: string[]; error?: string }> {
    const paths: string[] = [];
    for (const { file } of pending) {
      const contents = await file.text();
      if (isNonTextFileContents(contents)) {
        return {
          paths,
          error: `${file.name} is not a text file.`,
        };
      }
      const path = gen2ChatUploadPath(file.name);
      const response = await fetch(
        `/api/gen2/workspaces/${workspace.id}/files`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, contents, overwrite: true }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        return {
          paths,
          error: payload.error ?? `${file.name} could not be uploaded.`,
        };
      }
      paths.push(path);
    }
    return { paths };
  }

  async function send(overridePrompt?: string) {
    const text = (overridePrompt ?? prompt).trim();
    const pending = attachments;
    if (
      (!text && pending.length === 0) ||
      running ||
      starting ||
      sendingRef.current
    )
      return;
    sendingRef.current = true;
    pinToLatest();
    setStarting(true);
    setError("");
    setPrompt("");
    setAttachments([]);

    const pendingMessageId = `pending-${crypto.randomUUID()}`;
    let accepted = false;
    try {
      if (!ready) {
        setWaking(true);
        const started = await onNeedsMachine();
        setWaking(false);
        if (!started) {
          setError("Couldn’t reconnect to the workspace. Please try again.");
          setPrompt(text);
          setAttachments(pending);
          return;
        }
      }

      let target = chatId;
      if (!target) {
        const created = await fetch(
          `/api/gen2/workspaces/${workspace.id}/chats`,
          { method: "POST" },
        );
        if (!created.ok) {
          setError("Couldn't start a chat.");
          setPrompt(text);
          setAttachments(pending);
          return;
        }
        target = ((await created.json()) as { chat: Gen2Chat }).chat.id;
        setChatId(target);
      }

      let promptBody = text;
      if (pending.length > 0) {
        try {
          const uploaded = await uploadAttachments(pending);
          if (uploaded.error) {
            setError(uploaded.error);
            setPrompt(text);
            setAttachments(pending);
            return;
          }
          promptBody = formatGen2AttachmentPrompt(uploaded.paths, text);
          onFilesChanged();
        } catch {
          setError("Couldn't upload those files. Try again.");
          setPrompt(text);
          setAttachments(pending);
          return;
        }
      }

      setThread((current) => ({
        messages: [
          ...current.messages,
          {
            id: pendingMessageId,
            role: "user",
            body: promptBody,
            items: null,
            createdAt: new Date().toISOString(),
          },
        ],
      }));

      const response = await fetch(
        `/api/gen2/workspaces/${workspace.id}/agent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: target,
            prompt: promptBody,
            provider: agent,
            idempotencyKey: crypto.randomUUID(),
            ...(worktreeId ? { worktreeId } : {}),
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
      };
      if (!response.ok || !payload.sessionId) {
        setError(payload.error ?? `${agentLabel} couldn't start.`);
        if (response.status === 409) void refreshProvider();
        return;
      }
      accepted = true;
      await drive(payload.sessionId, target, 0, agent);
    } catch {
      setError("Couldn't reach CoDev. Try again.");
    } finally {
      if (!accepted) {
        setPrompt((current) => current || text);
        setAttachments((current) => (current.length ? current : pending));
        setThread((current) => ({
          messages: current.messages.filter(
            (message) => message.id !== pendingMessageId,
          ),
        }));
      }
      sendingRef.current = false;
      setStarting(false);
    }
  }

  async function stop() {
    const session = sessionRef.current;
    abortRef.current?.abort();
    if (!session) return;
    await fetch(`/api/gen2/workspaces/${workspace.id}/agent`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session }),
    }).catch(() => undefined);
  }

  async function newChat() {
    const response = await fetch(`/api/gen2/workspaces/${workspace.id}/chats`, {
      method: "POST",
    });
    if (!response.ok) return;
    const { chat } = (await response.json()) as { chat: Gen2Chat };
    const next = [chat, ...chats];
    setChats(next);
    setChatId(chat.id);
    onChatsChange?.(next);
    onSelectChatId?.(chat.id);
    pinToLatest();
  }

  const handleProviderSelect = (newAgent: Gen2AgentChoice) => {
    setAgent(newAgent);
    onActiveProviderChange?.(newAgent);
  };

  const composer = (
    <form
      className="gen2-chat-composer"
      data-dragging={dragging || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragging(false);
        queueFiles(event.dataTransfer.files);
      }}
    >
      {attachments.length > 0 ? (
        <ul className="gen2-chat-attachments" aria-label="Attached files">
          {attachments.map(({ id, file }) => (
            <li key={id} className="gen2-chat-attachment">
              <FileText aria-hidden="true" />
              <span>{file.name}</span>
              <WorkspaceButton
                size="icon"
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((item) => item.id !== id),
                  )
                }
              >
                <X aria-hidden="true" />
              </WorkspaceButton>
            </li>
          ))}
        </ul>
      ) : null}

      <textarea
        ref={textareaRef}
        value={prompt}
        disabled={busy}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!busy) void send();
          }
        }}
        placeholder={
          dragging
            ? "Drop files to attach to this turn…"
            : busy
              ? `${agentLabel} is working…`
              : "Ask a question or describe changes…"
        }
        rows={empty ? 3 : 2}
        className="gen2-chat-composer-input"
        aria-label="Prompt"
      />

      <div className="gen2-chat-composer-toolbar">
        <input
          ref={fileInputRef}
          id={attachInputId}
          type="file"
          multiple
          className="gen2-composer-file-input"
          aria-label="Choose files to attach"
          onChange={(event) => {
            queueFiles(event.target.files);
            event.target.value = "";
          }}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <WorkspaceButton
              size="icon"
              type="button"
              aria-label="Attach files"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip aria-hidden="true" />
            </WorkspaceButton>
          </TooltipTrigger>
          <TooltipContent className="gen2-workspace-surface">
            Attach files (max 5, 1MB each)
          </TooltipContent>
        </Tooltip>

        <div className="gen2-chat-composer-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <WorkspaceButton
                type="button"
                size="toolbar"
                disabled={busy}
                aria-label="Agent"
              >
                {agentLabel}
                <ChevronDown aria-hidden="true" />
              </WorkspaceButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="gen2-workspace-surface">
              <DropdownMenuRadioGroup
                value={agent}
                onValueChange={(value) =>
                  handleProviderSelect(value as Gen2AgentChoice)
                }
              >
                {GEN2_AGENT_PROVIDERS.map((entry) => (
                  <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {running ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <WorkspaceButton
                  type="button"
                  size="icon"
                  tone="primary"
                  onClick={() => void stop()}
                  aria-label={`Stop ${agentLabel}`}
                >
                  <Square aria-hidden="true" />
                </WorkspaceButton>
              </TooltipTrigger>
              <TooltipContent className="gen2-workspace-surface">
                Stop
              </TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <WorkspaceButton
                  type="submit"
                  size="icon"
                  tone="primary"
                  disabled={!canSend}
                  aria-label="Send"
                >
                  <ArrowUp aria-hidden="true" />
                </WorkspaceButton>
              </TooltipTrigger>
              <TooltipContent className="gen2-workspace-surface">
                Send
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </form>
  );

  const errorBanner = error ? (
    <div className="gen2-chat-alert" role="alert">
      <span>{error}</span>
      <WorkspaceButton
        size="icon"
        type="button"
        aria-label="Dismiss error"
        onClick={() => setError("")}
      >
        <X aria-hidden="true" />
      </WorkspaceButton>
    </div>
  ) : null;

  return (
    <TooltipProvider delayDuration={300}>
      <section className="gen2-chat-panel" aria-label="Agent chat">
        {!hideChatBar ? (
          <header className="gen2-chat-panel-bar">
            <WorkspaceButton
              type="button"
              tone="secondary"
              size="toolbar"
              onClick={() => void newChat()}
            >
              <Plus aria-hidden="true" /> New chat
            </WorkspaceButton>
            {chats.length > 0 ? (
              <nav className="gen2-chat-panel-tabs" aria-label="Chats">
                {chats.slice(0, 5).map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    className={cn(
                      "gen2-chat-panel-tab",
                      chat.id === chatId && "is-current",
                    )}
                    aria-current={chat.id === chatId}
                    onClick={() => {
                      setChatId(chat.id);
                      onSelectChatId?.(chat.id);
                      pinToLatest();
                    }}
                    title={chat.title}
                  >
                    {chat.title}
                  </button>
                ))}
              </nav>
            ) : null}
          </header>
        ) : null}

        {empty ? (
          <div className="gen2-chat-empty">
            <div className="gen2-chat-empty-inner">
              <div className="gen2-chat-empty-intro">
                <h2>What should we build?</h2>
                <p className="gen2-chat-empty-copy">
                  {agentLabel} can help you explore files, run commands, and
                  build in this workspace.
                </p>
              </div>

              {provider !== null && !provider.connected ? (
                <Gen2ConnectProvider
                  agent={agent}
                  onConnected={() => void refreshProvider()}
                />
              ) : (
                <>
                  {composer}
                  {errorBanner}
                  <div className="gen2-chat-suggestions">
                    {SUGGESTIONS.map((sug) => (
                      <button
                        key={sug.title}
                        type="button"
                        className="gen2-chat-suggestion"
                        onClick={() => {
                          setPrompt(sug.prompt);
                          textareaRef.current?.focus();
                        }}
                      >
                        <span className="gen2-chat-suggestion-title">
                          {sug.title}
                        </span>
                        <span className="gen2-chat-suggestion-desc">
                          {sug.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="gen2-chat-filled">
            <div className="gen2-chat-transcript-wrap">
              <div
                ref={transcriptRef}
                className="gen2-chat-transcript"
                onScroll={onScroll}
              >
                <ol className="gen2-chat-thread">
                  {thread.messages.map((message) => {
                    const isUser = message.role === "user";
                    return (
                      <li
                        key={message.id}
                        data-role={message.role}
                        className={cn(
                          "gen2-chat-turn",
                          isUser && "gen2-chat-turn-user",
                        )}
                      >
                        {isUser ? (
                          <div className="gen2-chat-user">
                            <p>{message.body}</p>
                          </div>
                        ) : (
                          <div className="gen2-chat-assistant">
                            {message.items?.length ? (
                              <Gen2TurnActivity
                                items={message.items}
                                onOpenFile={onOpenFile}
                              />
                            ) : null}
                            <MarkdownContent
                              className="gen2-chat-markdown"
                              text={message.body}
                            />
                            <MessageActionButtons text={message.body} />
                          </div>
                        )}
                      </li>
                    );
                  })}

                  {running || starting ? (
                    <li data-role="assistant" className="gen2-chat-turn">
                      <div className="gen2-chat-assistant">
                        <Gen2TurnActivity
                          items={items}
                          onOpenFile={onOpenFile}
                          live
                        />
                        {liveReply ? (
                          <MarkdownContent
                            className="gen2-chat-markdown"
                            text={liveReply}
                          />
                        ) : items.length === 0 ? (
                          <div className="gen2-chat-thinking" role="status">
                            Thinking…
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ) : null}
                </ol>
              </div>
              {showJump ? (
                <div className="gen2-chat-jump">
                  <WorkspaceButton
                    type="button"
                    tone="secondary"
                    size="toolbar"
                    onClick={jumpToLatest}
                  >
                    <ArrowDown aria-hidden="true" />
                    Jump to latest
                  </WorkspaceButton>
                </div>
              ) : null}
            </div>

            <div className="gen2-chat-dock">
              {errorBanner}
              {composer}
            </div>
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}

function MessageActionButtons({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="gen2-chat-message-actions">
      <Tooltip>
        <TooltipTrigger asChild>
          <WorkspaceButton
            size="icon"
            type="button"
            aria-label="Copy message"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </WorkspaceButton>
        </TooltipTrigger>
        <TooltipContent className="gen2-workspace-surface">
          {copied ? "Copied" : "Copy"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
