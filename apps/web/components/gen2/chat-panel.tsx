"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowUp, Paperclip, Plus, Square, X } from "lucide-react";
import type {
  Gen2Chat,
  Gen2ChatDetail,
  Gen2ChatMessage,
  Gen2TurnItem,
  Gen2WorkspaceDetail,
} from "@codev/contracts";

import { MarkdownContent } from "@/components/markdown/markdown-content";
import { canRunGen2Agent } from "@/lib/gen2/agent-policy";
import {
  formatGen2AttachmentPrompt,
  gen2ChatUploadPath,
  isNonTextFileContents,
  MAX_GEN2_CHAT_ATTACHMENT_BYTES,
  MAX_GEN2_CHAT_ATTACHMENTS,
} from "@/lib/gen2/chat-attachments";
import {
  decodeCodexExecOutput,
  mergeCodexExecChunks,
  type CodexExecChunk,
} from "@/lib/gen2/codex-output";
import { reduceCodexTurn } from "@/lib/gen2/turn-events";
import { Gen2ConnectProvider, useGen2ProviderStatus } from "./connect-provider";
import { Gen2TurnActivity } from "./turn-activity";

type Thread = { messages: Gen2ChatMessage[] };
type PendingFile = { id: string; file: File };

const STORAGE_PREFIX = "codev-gen2-turn:";

const SUGGESTIONS = [
  "Scaffold a small Next.js app",
  "Set up a Python project with tests",
  "Show me what's on this machine",
];

function storedTurn(workspaceId: string) {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + workspaceId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      chatId: string;
      sessionId: string;
      after: number;
    };
    return parsed.chatId && parsed.sessionId ? parsed : null;
  } catch {
    return null;
  }
}

function rememberTurn(
  workspaceId: string,
  turn: { chatId: string; sessionId: string; after: number } | null,
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
}: {
  workspace: Gen2WorkspaceDetail;
  onRunningChange: (running: boolean) => void;
  onFilesChanged: () => void;
  onOpenFile: (path: string) => void;
  /** Brings the machine up; resolves false if it could not. */
  onNeedsMachine: () => Promise<boolean>;
}) {
  const [chats, setChats] = useState<Gen2Chat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread>({ messages: [] });
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [items, setItems] = useState<Gen2TurnItem[]>([]);
  const [liveReply, setLiveReply] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const attachInputId = useId();
  const [waking, setWaking] = useState(false);
  const { status: provider, refresh: refreshProvider } =
    useGen2ProviderStatus();
  const ready = canRunGen2Agent(workspace.status);
  const needsProvider = provider !== null && !provider.connected;
  const canSend = Boolean(prompt.trim() || attachments.length > 0);

  useEffect(() => onRunningChange(running), [running, onRunningChange]);

  const loadChats = useCallback(async () => {
    const response = await fetch(`/api/gen2/workspaces/${workspace.id}/chats`);
    if (!response.ok) return;
    const payload = (await response.json()) as { chats?: Gen2Chat[] };
    setChats(payload.chats ?? []);
    setChatId((current) => current ?? payload.chats?.[0]?.id ?? null);
  }, [workspace.id]);

  useEffect(() => {
    // Fetch-on-mount. apps/web has no data-fetching library, so an effect
    // is where a client component loads from its own API; these updates
    // land in an async continuation, which the rule cannot see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setThread({ messages: [] });
      return;
    }
    // Fetch-on-mount. apps/web has no data-fetching library, so an effect
    // is where a client component loads from its own API; these updates
    // land in an async continuation, which the rule cannot see.
    void loadThread(chatId);
  }, [chatId, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread.messages.length, items.length, liveReply]);

  /** Drives one turn to completion, re-reducing the stream on every poll. */
  const drive = useCallback(
    async (session: string, chat: string, startAfter: number) => {
      const controller = new AbortController();
      abortRef.current = controller;
      sessionRef.current = session;
      setRunning(true);
      let chunks: CodexExecChunk[] = [];
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
            chunks?: CodexExecChunk[];
            nextSequence?: number;
            exited?: boolean;
          };
          // A proxy hiccup or an error page can return a 200 with a body that
          // is not a poll result. Treat it as "nothing new" rather than
          // letting the whole turn fall over.
          chunks = mergeCodexExecChunks(
            chunks,
            Array.isArray(payload.chunks) ? payload.chunks : [],
          );
          after = payload.nextSequence ?? after;
          rememberTurn(workspace.id, {
            chatId: chat,
            sessionId: session,
            after,
          });

          const state = reduceCodexTurn(decodeCodexExecOutput(chunks));
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
        abortRef.current = null;
        sessionRef.current = null;
        rememberTurn(workspace.id, null);
        setRunning(false);
        setItems([]);
        setLiveReply("");
        // The server persisted the reply as the turn exited, so re-reading
        // the thread is what puts it on screen — no client-side save.
        await loadThread(chat);
        await loadChats();
        // The agent and this browser share one filesystem; anything it wrote
        // should be visible in the workbench straight away.
        if (sawFileChange) onFilesChanged();
      }
    },
    [workspace.id, loadThread, loadChats, onFilesChanged, refreshProvider],
  );

  // Rejoin a turn that was still running when the page reloaded.
  useEffect(() => {
    const stored = storedTurn(workspace.id);
    if (!stored) return;
    // Rejoining a turn that outlived the page: the server kept streaming it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChatId(stored.chatId);
    void drive(stored.sessionId, stored.chatId, stored.after);
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

  async function send() {
    const text = prompt.trim();
    const pending = attachments;
    if ((!text && pending.length === 0) || running) return;
    setError("");
    setPrompt("");
    setAttachments([]);

    // The composer is never disabled. If the machine is not up yet, say so
    // and bring it up rather than making the member find a button.
    if (!ready) {
      setWaking(true);
      const started = await onNeedsMachine();
      setWaking(false);
      if (!started) {
        setError("The machine could not start. Try again in a moment.");
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
        // Files are now on the shared guest FS — refresh the tree.
        onFilesChanged();
      } catch {
        setError("Couldn't upload those files. Try again.");
        setPrompt(text);
        setAttachments(pending);
        return;
      }
    }

    // Show the prompt immediately; the server writes it as the turn starts.
    setThread((current) => ({
      messages: [
        ...current.messages,
        {
          id: `pending-${Date.now()}`,
          role: "user",
          body: promptBody,
          items: null,
          createdAt: new Date().toISOString(),
        },
      ],
    }));

    try {
      const response = await fetch(
        `/api/gen2/workspaces/${workspace.id}/agent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: target,
            prompt: promptBody,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
      };
      if (!response.ok || !payload.sessionId) {
        setError(payload.error ?? "Codex couldn't start.");
        // A 409 here is usually a missing or busy credential; re-read it so
        // the connect card appears instead of just an error string.
        if (response.status === 409) void refreshProvider();
        return;
      }
      await drive(payload.sessionId, target, 0);
    } catch {
      setError("Couldn't reach CoDev. Try again.");
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
    setChats((current) => [chat, ...current]);
    setChatId(chat.id);
  }

  const empty = thread.messages.length === 0 && !running;

  const composer = (
    <form
      className="gen2-composer"
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
        <ul className="gen2-composer-files" aria-label="Attached files">
          {attachments.map(({ id, file }) => (
            <li key={id}>
              <span title={file.name}>{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((item) => item.id !== id),
                  )
                }
              >
                <X aria-hidden="true" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
        placeholder={
          dragging
            ? "Drop files to attach"
            : "Ask Codex to build something on this machine"
        }
        rows={empty ? 3 : 2}
        aria-label="Prompt"
      />
      <div className="gen2-composer-row">
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
        <button
          type="button"
          className="gen2-composer-attach"
          aria-label="Attach files"
          disabled={running}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip aria-hidden="true" size={15} />
        </button>
        <span className="gen2-composer-hint">
          {waking
            ? "Waking the machine…"
            : running
              ? "Codex is working"
              : ready
                ? "Enter to send · text files only"
                : "Starting the machine"}
        </span>
        {running ? (
          <button
            type="button"
            className="gen2-composer-stop"
            onClick={() => void stop()}
            aria-label="Stop Codex"
          >
            <Square aria-hidden="true" size={11} />
          </button>
        ) : (
          <button
            type="submit"
            className="gen2-composer-send"
            disabled={!canSend}
            aria-label="Send"
          >
            <ArrowUp aria-hidden="true" size={15} />
          </button>
        )}
      </div>
    </form>
  );

  return (
    <section className="gen2-chat" aria-label="Codex">
      <header className="gen2-chat-bar">
        <button
          type="button"
          className="gen2-chat-new"
          onClick={() => void newChat()}
        >
          <Plus aria-hidden="true" size={13} /> New chat
        </button>
        {chats.length > 0 ? (
          <nav className="gen2-chat-tabs" aria-label="Chats">
            {chats.slice(0, 6).map((chat) => (
              <button
                key={chat.id}
                type="button"
                className="gen2-chat-tab"
                aria-current={chat.id === chatId}
                onClick={() => setChatId(chat.id)}
                title={chat.title}
              >
                {chat.title}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      {empty ? (
        <div className="gen2-chat-hero">
          <div className="gen2-chat-hero-inner">
            <h2>What should we build?</h2>
            <p>
              Codex works on this workspace&rsquo;s own machine. You can watch
              the files, terminal, and Git change beside it.
            </p>
            {needsProvider ? (
              <Gen2ConnectProvider onConnected={() => void refreshProvider()} />
            ) : (
              <>
                {composer}
                {error ? (
                  <p className="gen2-chat-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <ul className="gen2-chat-suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onClick={() => setPrompt(suggestion)}
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="gen2-chat-scroll">
            <ol className="gen2-thread">
              {thread.messages.map((message) => (
                <li key={message.id} data-role={message.role}>
                  {message.items?.length ? (
                    <Gen2TurnActivity
                      items={message.items}
                      onOpenFile={onOpenFile}
                    />
                  ) : null}
                  <MarkdownContent
                    text={message.body}
                    className="gen2-message"
                  />
                </li>
              ))}
              {running ? (
                <li data-role="assistant">
                  <Gen2TurnActivity items={items} onOpenFile={onOpenFile} />
                  {liveReply ? (
                    <MarkdownContent
                      text={liveReply}
                      className="gen2-message"
                    />
                  ) : items.length === 0 ? (
                    <p
                      className="gen2-message gen2-message-waiting"
                      role="status"
                    >
                      Codex is starting…
                    </p>
                  ) : null}
                </li>
              ) : null}
            </ol>
            <div ref={bottomRef} />
          </div>

          {error ? (
            <p className="gen2-wb-banner gen2-wb-banner-error" role="alert">
              {error}
            </p>
          ) : null}

          {composer}
        </>
      )}
    </section>
  );
}
