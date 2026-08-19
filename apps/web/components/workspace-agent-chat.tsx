"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ClaudeMark, OpenAIMark } from "@/components/settings/provider-logos";

type ChatProvider = "openai" | "anthropic";

type AgentTurn = {
  id: string;
  prompt: string;
  status: "queued" | "running" | "completed" | "interrupted" | "failed";
  output: string | null;
  lastError: string | null;
  createdAt: string;
};

type AgentSession = {
  id: string;
  provider: string;
  status: string;
  lastError: string | null;
  createdAt: string;
  turns: AgentTurn[];
};

const PROVIDER_META: Record<
  ChatProvider,
  { label: string; logo: React.ReactNode }
> = {
  openai: {
    label: "Codex",
    logo: <OpenAIMark className="workspace-chat-provider-mark" />,
  },
  anthropic: {
    label: "Claude",
    logo: <ClaudeMark className="workspace-chat-provider-mark" />,
  },
};

function isPending(turn: AgentTurn | undefined) {
  return turn?.status === "queued" || turn?.status === "running";
}

async function parseJson(response: Response) {
  return response.json().catch(() => null) as Promise<{
    error?: string;
  } | null>;
}

export function WorkspaceAgentChat({
  workspaceId,
  hasRepository,
  availableProviders,
  onOpenIde,
}: {
  workspaceId: string;
  hasRepository: boolean;
  availableProviders: ChatProvider[];
  onOpenIde: () => void;
}) {
  const [provider, setProvider] = useState<ChatProvider>(
    availableProviders[0] ?? "openai",
  );
  const [session, setSession] = useState<AgentSession | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastTurn = session?.turns[session.turns.length - 1];
  const pending = isPending(lastTurn) || sending;

  const fetchSessions = useCallback(async (): Promise<AgentSession[]> => {
    const response = await fetch(`/api/workspaces/${workspaceId}/agents`, {
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = (await response.json().catch(() => null)) as {
      sessions?: AgentSession[];
    } | null;
    return payload?.sessions ?? [];
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sessions = await fetchSessions();
      if (cancelled) return;
      const latest = [...sessions].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0];
      if (latest) {
        setSession(latest);
        if (latest.provider === "openai" || latest.provider === "anthropic") {
          setProvider(latest.provider);
        }
      }
      setLoadingHistory(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchSessions]);

  const lastTurnStatus = lastTurn?.status;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [session?.turns.length, lastTurnStatus]);

  useEffect(() => {
    if (!session || !isPending(session.turns[session.turns.length - 1])) {
      return;
    }
    pollTimer.current = setTimeout(async () => {
      const sessions = await fetchSessions();
      const next = sessions.find((candidate) => candidate.id === session.id);
      if (next) setSession(next);
    }, 2000);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [session, fetchSessions]);

  const send = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || pending) return;
    setError(null);
    setSending(true);
    setDraft("");
    try {
      if (!session) {
        const response = await fetch(`/api/workspaces/${workspaceId}/agents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: prompt.slice(0, 32) || "Chat",
            prompt,
            provider,
          }),
        });
        if (!response.ok) {
          const payload = await parseJson(response);
          setError(payload?.error ?? "Could not start the agent.");
          setDraft(prompt);
          return;
        }
        const sessions = await fetchSessions();
        const created = sessions
          .filter((candidate) => candidate.provider === provider)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (created) setSession(created);
      } else {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/agents/${session.id}/turns`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt }),
          },
        );
        if (!response.ok) {
          const payload = await parseJson(response);
          setError(payload?.error ?? "Could not send that message.");
          setDraft(prompt);
          return;
        }
        const sessions = await fetchSessions();
        const next = sessions.find((candidate) => candidate.id === session.id);
        if (next) setSession(next);
      }
    } finally {
      setSending(false);
    }
  }, [draft, pending, session, provider, workspaceId, fetchSessions]);

  const startNewChat = useCallback(() => {
    setSession(null);
    setError(null);
    setDraft("");
  }, []);

  const providerButtons = useMemo(
    () =>
      availableProviders.map((candidate) => (
        <button
          className={`workspace-chat-provider${
            provider === candidate ? " is-active" : ""
          }`}
          disabled={Boolean(session)}
          key={candidate}
          onClick={() => setProvider(candidate)}
          type="button"
        >
          {PROVIDER_META[candidate].logo}
          {PROVIDER_META[candidate].label}
        </button>
      )),
    [availableProviders, provider, session],
  );

  return (
    <div className="workspace-page workspace-chat">
      <header className="workspace-chat-header">
        <div className="workspace-chat-provider-group">{providerButtons}</div>
        <div className="workspace-chat-header-actions">
          {session ? (
            <button
              className="workspace-chat-link-button"
              onClick={startNewChat}
              type="button"
            >
              New chat
            </button>
          ) : null}
          <button
            className="workspace-chat-ide-button"
            onClick={onOpenIde}
            type="button"
          >
            Open IDE
          </button>
        </div>
      </header>

      <div className="workspace-chat-messages" ref={scrollRef}>
        {loadingHistory ? null : !session || session.turns.length === 0 ? (
          <div className="workspace-chat-empty">
            <p className="workspace-chat-empty-title">
              Start a chat with {PROVIDER_META[provider].label}
            </p>
            <p className="workspace-chat-empty-subtitle">
              Ask it to explain code, make a change, or investigate an issue in
              this workspace.
            </p>
          </div>
        ) : (
          <div className="workspace-chat-thread">
            {session.turns.map((turn) => (
              <div className="workspace-chat-turn" key={turn.id}>
                <div className="workspace-chat-bubble workspace-chat-bubble-user">
                  {turn.prompt}
                </div>
                {turn.status === "completed" && turn.output ? (
                  <div className="workspace-chat-bubble workspace-chat-bubble-agent">
                    {turn.output}
                  </div>
                ) : turn.status === "failed" ? (
                  <div className="workspace-chat-bubble workspace-chat-bubble-error">
                    {turn.lastError ?? "The agent could not complete this."}
                  </div>
                ) : (
                  <div className="workspace-chat-pending">
                    <span className="workspace-chat-pending-dot" />
                    {PROVIDER_META[provider].label} is working…
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="workspace-chat-composer">
        {!hasRepository ? (
          <p className="workspace-chat-hint">
            Connect a GitHub repository to this workspace before chatting with
            an agent.
          </p>
        ) : null}
        {error ? <p className="workspace-chat-error">{error}</p> : null}
        <div className="workspace-chat-input-row">
          <textarea
            className="workspace-chat-input"
            disabled={!hasRepository || pending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Send a message…"
            rows={1}
            value={draft}
          />
          <button
            className="workspace-chat-send"
            disabled={!hasRepository || !draft.trim() || pending}
            onClick={() => void send()}
            type="button"
          >
            <svg aria-hidden height="16" viewBox="0 0 16 16" width="16">
              <path
                d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
