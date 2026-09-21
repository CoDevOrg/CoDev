"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Square } from "lucide-react";
import type {
  Gen2Chat,
  Gen2ChatDetail,
  Gen2ChatMessage,
  Gen2TurnItem,
  Gen2WorkspaceDetail,
} from "@codev/contracts";

import { canRunGen2Agent } from "@/lib/gen2/agent-policy";
import {
  GEN2_NEW_CHAT_TITLE,
  gen2ChatTitleFromPrompt,
} from "@/lib/gen2/chats-format";
import {
  decodeCodexExecOutput,
  mergeCodexExecChunks,
  type CodexExecChunk,
} from "@/lib/gen2/codex-output";
import { reduceCodexTurn } from "@/lib/gen2/turn-events";
import { Gen2TurnActivity } from "./turn-activity";

type Thread = { messages: Gen2ChatMessage[] };

const STORAGE_PREFIX = "codev-gen2-turn:";

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
}: {
  workspace: Gen2WorkspaceDetail;
  onRunningChange: (running: boolean) => void;
  onFilesChanged: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [chats, setChats] = useState<Gen2Chat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread>({ messages: [] });
  const [prompt, setPrompt] = useState("");
  const [items, setItems] = useState<Gen2TurnItem[]>([]);
  const [liveReply, setLiveReply] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const ready = canRunGen2Agent(workspace.status);

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
    [workspace.id, loadThread, loadChats, onFilesChanged],
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

  async function send() {
    const text = prompt.trim();
    if (!text || running || !ready) return;
    setError("");
    setPrompt("");

    let target = chatId;
    if (!target) {
      const created = await fetch(
        `/api/gen2/workspaces/${workspace.id}/chats`,
        { method: "POST" },
      );
      if (!created.ok) {
        setError("Couldn't start a chat.");
        return;
      }
      target = ((await created.json()) as { chat: Gen2Chat }).chat.id;
      setChatId(target);
    }

    // Show the prompt immediately; the server writes it as the turn starts.
    setThread((current) => ({
      messages: [
        ...current.messages,
        {
          id: `pending-${Date.now()}`,
          role: "user",
          body: text,
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
            prompt: text,
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

  return (
    <section className="gen2-chat" aria-label="Codex">
      <header className="gen2-chat-bar">
        <select
          className="gen2-chat-select"
          aria-label="Chat"
          value={chatId ?? ""}
          onChange={(event) => setChatId(event.target.value || null)}
        >
          {chats.length === 0 ? <option value="">New chat</option> : null}
          {chats.map((chat) => (
            <option key={chat.id} value={chat.id}>
              {chat.title === GEN2_NEW_CHAT_TITLE
                ? gen2ChatTitleFromPrompt(chat.title)
                : chat.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="gen2-wb-icon-button"
          onClick={() => void newChat()}
          aria-label="New chat"
        >
          <Plus aria-hidden="true" size={14} />
        </button>
      </header>

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
              <p className="gen2-message">{message.body}</p>
            </li>
          ))}
          {running ? (
            <li data-role="assistant">
              <Gen2TurnActivity items={items} onOpenFile={onOpenFile} />
              {liveReply ? (
                <p className="gen2-message">{liveReply}</p>
              ) : items.length === 0 ? (
                <p className="gen2-message gen2-message-waiting" role="status">
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

      <form
        className="gen2-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
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
            ready
              ? "Ask Codex to work on this machine…"
              : "Start the instance first"
          }
          disabled={!ready || running}
          rows={3}
          aria-label="Prompt"
        />
        {running ? (
          <button
            type="button"
            className="gen2-wb-button"
            onClick={() => void stop()}
          >
            <Square aria-hidden="true" size={12} /> Stop
          </button>
        ) : (
          <button
            type="submit"
            className="primary-button"
            disabled={!ready || !prompt.trim()}
          >
            Send
          </button>
        )}
      </form>
    </section>
  );
}
