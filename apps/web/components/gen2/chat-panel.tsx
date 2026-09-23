"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Square } from "lucide-react";
import type {
  Gen2Chat,
  Gen2ChatDetail,
  Gen2ChatMessage,
  Gen2ProviderId,
  Gen2TurnItem,
  Gen2WorkspaceDetail,
} from "@codev/contracts";

import { canRunGen2Agent } from "@/lib/gen2/agent-policy";
import {
  decodeCodexExecOutput,
  mergeCodexExecChunks,
  type CodexExecChunk,
} from "@/lib/gen2/codex-output";
import { reduceCodexTurn } from "@/lib/gen2/turn-events";
import { Gen2ConnectProvider, useGen2ProviderStatus } from "./connect-provider";
import { Gen2TurnActivity } from "./turn-activity";

type Thread = { messages: Gen2ChatMessage[] };

const STORAGE_PREFIX = "codev-gen2-turn:";

const SUGGESTIONS = [
  "Scaffold a small Next.js app",
  "Set up a Python project with tests",
  "Show me what's on this machine",
];

const GEN2_PROVIDERS: Array<{ id: Gen2ProviderId; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "cursor", label: "Cursor" },
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
  onChatChange,
  onFilesChanged,
  onOpenFile,
  onNeedsMachine,
}: {
  workspace: Gen2WorkspaceDetail;
  onRunningChange: (running: boolean) => void;
  onChatChange?: (chatId: string | null) => void;
  onFilesChanged: () => void;
  onOpenFile: (path: string) => void;
  /** Brings the machine up; resolves false if it could not. */
  onNeedsMachine: () => Promise<boolean>;
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
  const [waking, setWaking] = useState(false);
  const [providerSaving, setProviderSaving] = useState(false);
  const {
    status: provider,
    providers,
    refresh: refreshProvider,
  } = useGen2ProviderStatus();
  const ready = canRunGen2Agent(workspace.status);
  const needsProvider = provider !== null && !provider.connected;
  const selectedChat = chats.find((chat) => chat.id === chatId);
  const selectedProvider = selectedChat?.defaultProvider ?? "openai";
  const providerChoices = GEN2_PROVIDERS.map((choice) => {
    const readiness = providers?.find((item) => item.id === choice.id);
    const installed = readiness?.installed ?? choice.id === "openai";
    const connected =
      readiness?.ready ??
      (choice.id === "openai" && provider?.connected === true);
    const canRun = readiness?.capabilities.canRun ?? choice.id === "openai";
    return {
      ...choice,
      enabled: installed && connected && canRun,
      installed,
      connected,
    };
  });
  const selectedProviderChoice = providerChoices.find(
    (choice) => choice.id === selectedProvider,
  );
  // `provider`/`providers` are null until the initial /api/gen2/providers
  // fetch resolves. The composer must stay usable during that window (see
  // the "wakes the machine" test below), so treat the default OpenAI
  // provider as runnable while its real readiness is still loading rather
  // than disabling the composer.
  const providerLoading = provider === null && providers === null;
  const canRunSelectedProvider =
    selectedProviderChoice?.enabled === true ||
    (providerLoading && selectedProvider === "openai");

  useEffect(() => onRunningChange(running), [running, onRunningChange]);

  useEffect(() => onChatChange?.(chatId), [chatId, onChatChange]);

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
      if (payload.chat) {
        setChats((current) =>
          current.map((chat) =>
            chat.id === payload.chat?.id ? { ...chat, ...payload.chat } : chat,
          ),
        );
      }
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

  async function send() {
    const text = prompt.trim();
    if (!text || running) return;
    if (!canRunSelectedProvider) {
      setError("Connect a supported provider before starting this turn.");
      return;
    }
    setError("");

    // The composer is never disabled. If the machine is not up yet, say so
    // and bring it up rather than making the member find a button.
    if (!ready) {
      setWaking(true);
      const started = await onNeedsMachine();
      setWaking(false);
      if (!started) {
        setError("The machine could not start. Try again in a moment.");
        return;
      }
    }

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
          provider: null,
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
            provider: selectedProvider,
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

  async function saveDefaultProvider(nextProvider: Gen2ProviderId) {
    if (providerSaving || nextProvider === selectedProvider) return;
    const nextChoice = providerChoices.find(
      (choice) => choice.id === nextProvider,
    );
    if (!nextChoice?.enabled) return;

    setProviderSaving(true);
    setError("");
    try {
      let targetChatId = chatId;
      if (!targetChatId) {
        const created = await fetch(
          `/api/gen2/workspaces/${workspace.id}/chats`,
          { method: "POST" },
        );
        const payload = (await created.json().catch(() => ({}))) as {
          chat?: Gen2Chat;
          error?: string;
        };
        if (!created.ok || !payload.chat) {
          throw new Error(payload.error ?? "Could not create a chat.");
        }
        targetChatId = payload.chat.id;
        setChats((current) => [payload.chat!, ...current]);
        setChatId(targetChatId);
      }

      const response = await fetch(
        `/api/gen2/workspaces/${workspace.id}/chats/${targetChatId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ defaultProvider: nextProvider }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        chat?: Gen2Chat;
        error?: string;
      };
      if (!response.ok || !payload.chat) {
        throw new Error(
          payload.error ?? "Could not save this chat's provider.",
        );
      }
      setChats((current) =>
        current.map((chat) =>
          chat.id === payload.chat?.id ? { ...chat, ...payload.chat } : chat,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this chat's provider.",
      );
    } finally {
      setProviderSaving(false);
    }
  }

  const empty = thread.messages.length === 0 && !running;

  const composer = (
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
        placeholder={`Ask ${selectedProviderChoice?.label ?? "an agent"} to build something on this machine`}
        rows={empty ? 3 : 2}
        aria-label="Prompt"
      />
      <div className="gen2-composer-row">
        <span className="gen2-composer-hint">
          {waking
            ? "Waking the machine…"
            : running
              ? "Codex is working"
              : ready
                ? "Enter to send"
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
            disabled={
              !prompt.trim() ||
              (!providerLoading && !canRunSelectedProvider) ||
              providerSaving ||
              !workspace.capabilities["agent.run"]
            }
            aria-label="Send"
          >
            <ArrowUp aria-hidden="true" size={15} />
          </button>
        )}
      </div>
    </form>
  );

  const providerPicker = (
    <div className="gen2-provider-picker">
      <label htmlFor="gen2-chat-provider">Provider</label>
      <select
        id="gen2-chat-provider"
        value={selectedProvider}
        disabled={
          providerSaving ||
          !workspace.capabilities["agent.run"] ||
          providerLoading
        }
        onChange={(event) =>
          void saveDefaultProvider(event.target.value as Gen2ProviderId)
        }
        aria-describedby="gen2-chat-provider-help"
      >
        {providerChoices.map((choice) => {
          const status = !choice.installed
            ? "Not yet supported"
            : choice.connected
              ? "Connected"
              : "Available · connect your account";
          return (
            <option
              disabled={!choice.enabled}
              key={choice.id}
              value={choice.id}
            >
              {choice.label} ({status})
            </option>
          );
        })}
      </select>
      <p id="gen2-chat-provider-help">
        {selectedProviderChoice?.enabled
          ? `This chat will use ${selectedProviderChoice.label}. The choice is saved with the chat.`
          : selectedProviderChoice?.installed
            ? `${selectedProviderChoice.label} is available, but you must connect your account before using it.`
            : `${selectedProviderChoice?.label ?? "This provider"} is not yet supported in Gen 2.`}
      </p>
      {providerSaving ? <span role="status">Saving provider…</span> : null}
    </div>
  );

  return (
    <section className="gen2-chat" aria-label="Agent chat">
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
            {providerPicker}
            {needsProvider ? (
              <Gen2ConnectProvider onConnected={() => void refreshProvider()} />
            ) : (
              composer
            )}
            {error ? (
              <p className="gen2-chat-error" role="alert">
                {error}
              </p>
            ) : null}
            <ul className="gen2-chat-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" onClick={() => setPrompt(suggestion)}>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
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
                  {message.role === "assistant" && message.provider ? (
                    <span className="gen2-message-provider">
                      {GEN2_PROVIDERS.find(
                        (choice) => choice.id === message.provider,
                      )?.label ?? message.provider}
                    </span>
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

          {providerPicker}
          {needsProvider ? (
            <Gen2ConnectProvider onConnected={() => void refreshProvider()} />
          ) : (
            composer
          )}
        </>
      )}
    </section>
  );
}
