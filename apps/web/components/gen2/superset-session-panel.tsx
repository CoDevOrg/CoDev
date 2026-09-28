"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Square } from "lucide-react";

import { MarkdownContent } from "@/components/markdown/markdown-content";

type Session = { sessionId: string; title?: string | null; status: string };
type Item = {
  id: string;
  kind: string;
  text?: string;
  title?: string;
  status?: string;
  content?: {
    type: string;
    text?: string;
    command?: string;
    output?: string;
    path?: string;
    newText?: string;
  }[];
  options?: { optionId: string; label: string }[];
};
type Envelope = {
  cursor: { epoch: string; seq: number };
  event: { type: string; item?: Item; turn?: { id: string; status: string } };
};

export function SupersetSessionPanel({
  workspaceId,
  ready,
  canEdit,
  onFilesChanged,
  onRunningChange,
}: {
  workspaceId: string;
  ready: boolean;
  canEdit: boolean;
  onFilesChanged: () => void;
  onRunningChange: (running: boolean) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [liveText, setLiveText] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loadedSessionRef = useRef<string | null>(null);
  const terminalSeqRef = useRef(0);
  const latestTurn = [...envelopes]
    .reverse()
    .find((envelope) => envelope.event.type === "turn")?.event.turn;
  const running = busy || latestTurn?.status === "running";
  const items = new Map<string, { item: Item; seq: number }>();
  for (const envelope of envelopes) {
    if (envelope.event.type === "item" && envelope.event.item) {
      const item = envelope.event.item;
      const previous = items.get(item.id);
      items.set(item.id, { item, seq: previous?.seq ?? envelope.cursor.seq });
    }
  }

  const call = useCallback(
    async (operation: string, input: object = {}) => {
      const response = await fetch(
        `/api/gen2/workspaces/${workspaceId}/superset/sessions/${operation}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error ?? "Superset session request failed.");
      return body;
    },
    [workspaceId],
  );

  const loadSessions = useCallback(async () => {
    const body = (await call("list")) as { sessions: Session[] };
    setSessions(body.sessions);
    setSelected((value) => value ?? body.sessions[0]?.sessionId ?? null);
  }, [call]);

  useEffect(() => {
    if (!ready) return;
    // Fetch-on-mount: state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSessions().catch((cause) =>
      setError(
        cause instanceof Error ? cause.message : "Could not load sessions.",
      ),
    );
  }, [ready, loadSessions]);

  useEffect(() => {
    if (!selected || !ready) return;
    let active = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const fullReplay = loadedSessionRef.current !== selected;
        const pages: Envelope[][] = [];
        let before: { epoch: string; seq: number } | undefined;
        let nextBefore: { epoch: string; seq: number } | null | undefined;
        let latestLiveText: Record<string, string> = {};
        do {
          const body = (await call("events", {
            sessionId: selected,
            before,
          })) as {
            ok: boolean;
            envelopes?: Envelope[];
            liveText?: Record<string, string>;
            nextBefore?: { epoch: string; seq: number } | null;
          };
          if (!body.ok)
            throw new Error("The session journal needs to be reloaded.");
          pages.unshift(body.envelopes ?? []);
          latestLiveText = body.liveText ?? latestLiveText;
          nextBefore = fullReplay ? body.nextBefore : null;
          before = nextBefore ?? undefined;
        } while (nextBefore && pages.length < 100);
        if (!active) return;
        const incoming = pages.flat();
        setEnvelopes((previous) => {
          if (fullReplay) return incoming;
          const seen = new Set(
            previous.map(
              (envelope) => `${envelope.cursor.epoch}:${envelope.cursor.seq}`,
            ),
          );
          return [
            ...previous,
            ...incoming.filter(
              (envelope) =>
                !seen.has(`${envelope.cursor.epoch}:${envelope.cursor.seq}`),
            ),
          ];
        });
        loadedSessionRef.current = selected;
        setLiveText(latestLiveText);
        const newestTerminal =
          incoming
            .filter(
              (envelope) =>
                envelope.event.type === "turn" &&
                envelope.event.turn?.status !== "running",
            )
            .at(-1)?.cursor.seq ?? 0;
        if (newestTerminal > terminalSeqRef.current) {
          terminalSeqRef.current = newestTerminal;
          onFilesChanged();
        }
        setError("");
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not reconnect to session.",
          );
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selected, ready, call, onFilesChanged]);

  useEffect(() => {
    onRunningChange(running);
  }, [running, onRunningChange]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [envelopes.length]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const body = (await call("create")) as { sessionId: string };
      setSelected(body.sessionId);
      setEnvelopes([]);
      setLiveText({});
      loadedSessionRef.current = null;
      terminalSeqRef.current = 0;
      await loadSessions();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create session.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!selected || !prompt.trim() || busy) return;
    const text = prompt.trim();
    setBusy(true);
    setError("");
    try {
      await call("prompt", {
        sessionId: selected,
        text,
        commandId: crypto.randomUUID(),
      });
      setPrompt("");
      onFilesChanged();
      await loadSessions();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not send prompt.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!selected || !latestTurn?.id) return;
    try {
      await call("cancel", {
        sessionId: selected,
        turnId: latestTurn.id,
        commandId: crypto.randomUUID(),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not cancel turn.",
      );
    }
  }

  async function approve(
    item: Item,
    decision: { type: "accept" | "decline" | "option"; optionId?: string },
  ) {
    if (!selected) return;
    try {
      await call("approve", {
        sessionId: selected,
        approvalId: item.id,
        decision,
        commandId: crypto.randomUUID(),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not answer approval.",
      );
    }
  }

  return (
    <section className="gen2-sessions" aria-label="Codex sessions">
      <header className="gen2-sessions-bar">
        <strong>Codex sessions</strong>
        <button
          type="button"
          onClick={() => void create()}
          disabled={!ready || !canEdit || busy}
          aria-label="New session"
        >
          <Plus size={16} />
        </button>
      </header>
      <nav className="gen2-sessions-tabs" aria-label="Sessions">
        {sessions.map((session) => (
          <button
            type="button"
            key={session.sessionId}
            aria-current={session.sessionId === selected ? "page" : undefined}
            onClick={() => {
              setSelected(session.sessionId);
              setEnvelopes([]);
              setLiveText({});
              loadedSessionRef.current = null;
              terminalSeqRef.current = 0;
            }}
          >
            {session.title || "New session"}
          </button>
        ))}
      </nav>
      <div className="gen2-sessions-scroll" role="log" aria-live="polite">
        {!selected && (
          <div className="gen2-sessions-empty">
            <h2>Start a Codex session</h2>
            <p>Each session uses your own connected OpenAI provider.</p>
            <button
              type="button"
              disabled={!ready || !canEdit || busy}
              onClick={() => void create()}
            >
              New session
            </button>
          </div>
        )}
        {[...items.values()].map(({ item, seq }) => {
          if (item.kind === "user_message")
            return (
              <div key={seq} className="gen2-sessions-user">
                {item.content
                  ?.filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n")}
              </div>
            );
          if (item.kind === "agent_message")
            return (
              <div key={seq} className="gen2-sessions-reply">
                <MarkdownContent
                  text={
                    (item.text?.length ?? 0) >= (liveText[item.id]?.length ?? 0)
                      ? (item.text ?? "")
                      : (liveText[item.id] ?? "")
                  }
                />
              </div>
            );
          if (item.kind === "approval_request")
            return (
              <div key={seq} className="gen2-sessions-activity">
                <strong>{item.title}</strong>
                {item.status === "pending" && canEdit && (
                  <div>
                    <button
                      type="button"
                      onClick={() => void approve(item, { type: "accept" })}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void approve(item, { type: "decline" })}
                    >
                      Decline
                    </button>
                    {item.options?.map((option) => (
                      <button
                        key={option.optionId}
                        type="button"
                        onClick={() =>
                          void approve(item, {
                            type: "option",
                            optionId: option.optionId,
                          })
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          if (item.kind === "tool_call")
            return (
              <details key={seq} className="gen2-sessions-activity">
                <summary>
                  {item.title || "Tool call"}
                  {item.status ? ` · ${item.status}` : ""}
                </summary>
                <pre>
                  {item.status === "running" && liveText[item.id]
                    ? liveText[item.id]
                    : item.content
                        ?.map(
                          (part) =>
                            part.command ||
                            part.output ||
                            part.text ||
                            part.newText ||
                            part.path ||
                            "",
                        )
                        .join("\n")}
                </pre>
              </details>
            );
          if (item.kind === "notice" || item.kind === "reasoning")
            return (
              <div key={seq} className="gen2-sessions-activity">
                {item.title || item.text || item.kind}
                {item.status ? ` · ${item.status}` : ""}
              </div>
            );
          return null;
        })}
        <div ref={bottomRef} />
      </div>
      {error && (
        <p className="gen2-sessions-error" role="alert">
          {error}
        </p>
      )}
      <form
        className="gen2-sessions-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="gen2-visually-hidden" htmlFor="gen2-superset-prompt">
          Ask Codex
        </label>
        <textarea
          id="gen2-superset-prompt"
          value={prompt}
          disabled={!selected || !ready || !canEdit}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="Ask Codex to work in this workspace"
          rows={3}
        />
        {running ? (
          <button
            type="button"
            onClick={() => void cancel()}
            aria-label="Stop turn"
            disabled={!canEdit}
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!selected || !ready || !canEdit || !prompt.trim()}
            aria-label="Send prompt"
          >
            <ArrowUp size={17} />
          </button>
        )}
      </form>
    </section>
  );
}
