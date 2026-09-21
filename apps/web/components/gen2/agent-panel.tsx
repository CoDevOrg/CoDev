"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  Gen2Chat,
  Gen2ChatDetail,
  Gen2ChatMessage,
  Gen2WorkspaceDetail,
} from "@codev/contracts";

import {
  decodeCodexExecOutput,
  mergeCodexExecChunks,
  parseCodexExecOutput,
  type CodexExecChunk,
} from "@/lib/gen2/codex-output";
import { canRunGen2Agent } from "@/lib/gen2/agent-policy";
import {
  GEN2_NEW_CHAT_TITLE,
  gen2ChatTitleFromPrompt,
} from "@/lib/gen2/chats-format";

type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  running?: boolean;
};

type StoredTurn = {
  chatId: string;
  messages: ThreadMessage[];
  sessionId: string;
  assistantId: string;
  after: number;
};

function storageKey(workspaceId: string) {
  return `codev-gen2-agent:${workspaceId}`;
}

function readStoredTurn(workspaceId: string): StoredTurn | null {
  try {
    const raw = sessionStorage.getItem(storageKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTurn;
    if (
      !parsed.chatId ||
      !parsed.sessionId ||
      !parsed.assistantId ||
      !Array.isArray(parsed.messages)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredTurn(workspaceId: string, turn: StoredTurn | null) {
  try {
    if (!turn) {
      sessionStorage.removeItem(storageKey(workspaceId));
      return;
    }
    sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(turn));
  } catch {
    /* Private mode or quota — the live turn still continues in this tab. */
  }
}

function readChatIdFromUrl() {
  try {
    return new URL(window.location.href).searchParams.get("chat");
  } catch {
    return null;
  }
}

function writeChatIdToUrl(chatId: string | null) {
  try {
    const url = new URL(window.location.href);
    if (chatId) url.searchParams.set("chat", chatId);
    else url.searchParams.delete("chat");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  } catch {
    /* jsdom or a sandboxed frame may reject history writes. */
  }
}

function newId() {
  return crypto.randomUUID();
}

function toThreadMessage(message: Gen2ChatMessage): ThreadMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.body,
  };
}

async function readError(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  return payload.error ?? "That action could not be completed.";
}

function isRetryableStatus(status: number) {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503
  );
}

async function wait(ms: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function Gen2AgentPanel({
  workspace,
}: {
  workspace: Gen2WorkspaceDetail;
}) {
  const fieldId = useId();
  const [chats, setChats] = useState<Gen2Chat[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const afterRef = useRef(0);
  const resumeRef = useRef(false);
  const skipThreadLoadRef = useRef(false);
  const ready = canRunGen2Agent(workspace.status);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (canRunGen2Agent(workspace.status)) return;
    abortRef.current?.abort();
    writeStoredTurn(workspace.id, null);
    setRunning(false);
  }, [workspace.id, workspace.status]);

  useEffect(() => {
    let cancelled = false;
    async function loadChats() {
      try {
        const response = await fetch(
          `/api/gen2/workspaces/${workspace.id}/chats`,
        );
        if (!response.ok) throw new Error(await readError(response));
        const payload = (await response.json()) as { chats?: Gen2Chat[] };
        if (cancelled) return;
        const next = payload.chats ?? [];
        setChats(next);
        const wanted =
          readChatIdFromUrl() ??
          readStoredTurn(workspace.id)?.chatId ??
          next[0]?.id ??
          null;
        const selected =
          wanted && next.some((chat) => chat.id === wanted)
            ? wanted
            : (next[0]?.id ?? null);
        setSelectedId(selected);
        writeChatIdToUrl(selected);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Couldn't load chats.",
          );
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void loadChats();
    return () => {
      cancelled = true;
    };
  }, [workspace.id]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    if (skipThreadLoadRef.current) {
      skipThreadLoadRef.current = false;
      return;
    }
    let cancelled = false;
    async function loadThread(chatId: string) {
      try {
        const response = await fetch(
          `/api/gen2/workspaces/${workspace.id}/chats/${chatId}`,
        );
        if (!response.ok) throw new Error(await readError(response));
        const payload = (await response.json()) as { chat?: Gen2ChatDetail };
        if (cancelled) return;
        const stored = readStoredTurn(workspace.id);
        if (stored?.chatId === chatId && stored.messages.length > 0) {
          setMessages(stored.messages);
          return;
        }
        setMessages((payload.chat?.messages ?? []).map(toThreadMessage));
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Couldn't load this chat.",
          );
        }
      }
    }
    void loadThread(selectedId);
    return () => {
      cancelled = true;
    };
  }, [selectedId, workspace.id]);

  async function pollOnce(
    sessionId: string,
    after: number,
    signal: AbortSignal,
    chatId: string,
  ) {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const response = await fetch(
          `/api/gen2/workspaces/${workspace.id}/agent/poll`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chatId, sessionId, after }),
            signal,
          },
        );
        if (response.ok) {
          const payload = (await response.json()) as {
            chunks: CodexExecChunk[];
            nextSequence: number;
            exited: boolean;
            exitCode: number | null;
          };
          if ("codexAuthCacheJson" in payload) {
            throw new Error("Unexpected auth material in the agent response.");
          }
          return payload;
        }
        if (!isRetryableStatus(response.status) || attempt >= 4) {
          throw new Error(await readError(response));
        }
      } catch (cause) {
        if (signal.aborted) throw cause;
        if (
          attempt >= 4 ||
          (cause instanceof Error &&
            cause.name !== "TypeError" &&
            cause.message !== "Failed to fetch")
        ) {
          throw cause;
        }
      }
      attempt += 1;
      await wait(400 * attempt, signal);
    }
    throw new DOMException("Aborted", "AbortError");
  }

  async function persistAssistantReply(chatId: string, body: string) {
    const text = body.trim();
    if (!text || text === "Working…") return;
    try {
      await fetch(
        `/api/gen2/workspaces/${workspace.id}/chats/${chatId}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: text }),
          keepalive: true,
        },
      );
    } catch {
      /* Live reply is already on screen. */
    }
  }

  async function pollTurn(
    sessionId: string,
    signal: AbortSignal,
    assistantId: string,
    chatId: string,
    startingAfter = 0,
  ) {
    const chunks: CodexExecChunk[] = [];
    let after = startingAfter;
    afterRef.current = after;
    while (!signal.aborted) {
      const payload = await pollOnce(sessionId, after, signal, chatId);
      after = payload.nextSequence;
      afterRef.current = after;
      const merged = mergeCodexExecChunks(chunks, payload.chunks);
      chunks.splice(0, chunks.length, ...merged);
      const output = decodeCodexExecOutput(chunks);
      const parsed = parseCodexExecOutput(output);
      const text =
        parsed.reply || (payload.exited ? output.trim() : "Working…");
      setMessages((current) => {
        const next = current.map((message) =>
          message.id === assistantId
            ? { ...message, text, running: !payload.exited }
            : message,
        );
        writeStoredTurn(
          workspace.id,
          payload.exited
            ? null
            : {
                chatId,
                messages: next,
                sessionId,
                assistantId,
                after,
              },
        );
        return next;
      });
      if (!payload.exited) continue;
      if (parsed.failed || (payload.exitCode !== 0 && !parsed.reply)) {
        throw new Error(
          parsed.reply ||
            "Codex could not finish this turn. Reconnect Codex if your login expired.",
        );
      }
      const reply = parsed.reply || text;
      await persistAssistantReply(chatId, reply);
      return reply;
    }
    throw new DOMException("Aborted", "AbortError");
  }

  async function runTurn(
    sessionId: string,
    assistantId: string,
    chatId: string,
    startingAfter = 0,
  ) {
    const controller = new AbortController();
    abortRef.current = controller;
    sessionRef.current = sessionId;
    setRunning(true);
    setStatus("Codex is working");
    try {
      await pollTurn(
        sessionId,
        controller.signal,
        assistantId,
        chatId,
        startingAfter,
      );
      setStatus("You can keep talking in this chat.");
      window.setTimeout(() => composerRef.current?.focus(), 0);
    } catch (cause) {
      if (controller.signal.aborted) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, text: "Stopped.", running: false }
              : message,
          ),
        );
        writeStoredTurn(workspace.id, null);
        setStatus("Codex stopped");
      } else {
        const message =
          cause instanceof Error ? cause.message : "Couldn't reach Codex.";
        setError(message);
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? { ...entry, text: message, running: false }
              : entry,
          ),
        );
        writeStoredTurn(workspace.id, null);
        setStatus("");
        await persistAssistantReply(chatId, message);
      }
    } finally {
      sessionRef.current = null;
      abortRef.current = null;
      setRunning(false);
    }
  }

  useEffect(() => {
    if (resumeRef.current || !ready || !loaded) return;
    const stored = readStoredTurn(workspace.id);
    if (!stored || stored.chatId !== selectedId) return;
    resumeRef.current = true;
    setMessages(stored.messages);
    void runTurn(
      stored.sessionId,
      stored.assistantId,
      stored.chatId,
      stored.after,
    );
    // Resume a turn that survived a refresh. Intentionally once per workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, ready, loaded, selectedId]);

  function selectChat(chatId: string) {
    if (running || chatId === selectedId) return;
    setError("");
    setStatus("");
    setPrompt("");
    setSelectedId(chatId);
    writeChatIdToUrl(chatId);
  }

  async function createChat() {
    if (running) return;
    setError("");
    const response = await fetch(`/api/gen2/workspaces/${workspace.id}/chats`, {
      method: "POST",
    });
    if (!response.ok) throw new Error(await readError(response));
    const payload = (await response.json()) as { chat?: Gen2Chat };
    if (!payload.chat) throw new Error("Couldn't create a chat.");
    setChats((current) => [
      payload.chat as Gen2Chat,
      ...current.filter((chat) => chat.id !== payload.chat?.id),
    ]);
    skipThreadLoadRef.current = true;
    setMessages([]);
    setSelectedId(payload.chat.id);
    writeChatIdToUrl(payload.chat.id);
    return payload.chat;
  }

  async function send() {
    const text = prompt.trim();
    if (!text || running || !ready || !loaded) return;
    let chatId = selectedId;
    setPrompt("");
    setError("");
    try {
      if (!chatId) {
        const created = await createChat();
        chatId = created?.id ?? null;
      }
      if (!chatId) throw new Error("Couldn't create a chat.");
      const assistantId = newId();
      const userMessage: ThreadMessage = { id: newId(), role: "user", text };
      setMessages((current) => [
        ...current,
        userMessage,
        { id: assistantId, role: "assistant", text: "Working…", running: true },
      ]);
      const idempotencyKey = newId();
      setRunning(true);
      setStatus("Starting Codex");
      const response = await fetch(
        `/api/gen2/workspaces/${workspace.id}/agent`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chatId, prompt: text, idempotencyKey }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { sessionId?: string };
      if (!payload.sessionId) throw new Error("Codex did not start.");
      if ("codexAuthCacheJson" in payload) {
        throw new Error("Unexpected auth material in the agent response.");
      }
      setChats((current) => {
        const selected = current.find((chat) => chat.id === chatId);
        if (!selected) return current;
        const titled =
          selected.title === GEN2_NEW_CHAT_TITLE
            ? { ...selected, title: gen2ChatTitleFromPrompt(text) }
            : selected;
        return [titled, ...current.filter((chat) => chat.id !== chatId)];
      });
      await runTurn(payload.sessionId, assistantId, chatId);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Couldn't reach Codex.";
      setError(message);
      setStatus("");
      setRunning(false);
    }
  }

  async function handleNewChat() {
    try {
      await createChat();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't create a chat.",
      );
    }
  }

  async function stop() {
    const sessionId = sessionRef.current;
    abortRef.current?.abort();
    writeStoredTurn(workspace.id, null);
    if (!sessionId) return;
    await fetch(`/api/gen2/workspaces/${workspace.id}/agent`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).catch(() => undefined);
  }

  const emptyComposer = messages.length === 0;

  return (
    <section
      className="gen2-agent"
      aria-labelledby="gen2-agent-heading"
      aria-busy={running}
    >
      <h2 id="gen2-agent-heading">Codex</h2>
      <p className="gen2-note">
        Stay in this chat and send another message to keep talking. New chat
        starts a separate thread.
      </p>
      <div className="gen2-agent-layout">
        <nav className="gen2-chat-nav" aria-label="Chats">
          <button
            className="secondary-button gen2-chat-new"
            type="button"
            disabled={running || !loaded}
            onClick={() => void handleNewChat()}
          >
            New chat
          </button>
          {loaded && chats.length === 0 ? (
            <p className="gen2-empty">
              No chats yet. Send a message to start one.
            </p>
          ) : (
            <ul>
              {chats.map((chat) => (
                <li key={chat.id}>
                  <button
                    className="gen2-chat-item"
                    type="button"
                    disabled={running}
                    aria-current={chat.id === selectedId ? "true" : undefined}
                    onClick={() => selectChat(chat.id)}
                  >
                    {chat.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="gen2-chat-thread">
          {messages.length > 0 ? (
            <div className="gen2-agent-log" aria-live="off">
              <ol>
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className={
                      message.role === "user"
                        ? "gen2-agent-user"
                        : "gen2-agent-assistant"
                    }
                  >
                    <span>{message.role === "user" ? "You" : "Codex"}</span>
                    <p>{message.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="gen2-empty">
              {loaded
                ? "This chat is empty. Ask Codex to inspect or change files."
                : "Loading chats…"}
            </p>
          )}
          {status ? (
            <p className="gen2-agent-live" role="status" aria-atomic="true">
              {status}
            </p>
          ) : null}
          {error ? (
            <p className="form-message error-copy" role="alert">
              {error}
            </p>
          ) : null}
          <form
            className={
              emptyComposer
                ? "gen2-agent-composer gen2-agent-composer-hero"
                : "gen2-agent-composer"
            }
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="gen2-field" htmlFor={fieldId}>
              <span>{emptyComposer ? "Message" : "Reply"}</span>
              <textarea
                id={fieldId}
                ref={composerRef}
                value={prompt}
                disabled={!ready || running || !loaded}
                rows={emptyComposer ? 8 : 3}
                maxLength={20_000}
                autoComplete="off"
                autoFocus={ready}
                placeholder={
                  !ready
                    ? "Start the instance first"
                    : emptyComposer
                      ? "Ask Codex to inspect or change files here."
                      : "Reply to Codex in this chat…"
                }
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
            </label>
            <div className="gen2-agent-composer-actions">
              {running ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void stop()}
                >
                  Stop
                </button>
              ) : (
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!ready || !loaded || !prompt.trim()}
                >
                  Send
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
