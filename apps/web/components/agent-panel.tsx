"use client";

import { useCallback, useEffect, useState } from "react";

type AgentSession = {
  id: string;
  name: string;
  model: string;
  status: string;
  worktreeName: string;
  lastError: string | null;
  turns: {
    id: string;
    prompt: string;
    status: string;
    output: string | null;
    lastError: string | null;
  }[];
  events: {
    id: string;
    type: string;
    payload: Record<string, unknown>;
  }[];
};

async function json<T>(response: Response) {
  const result = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(result?.error ?? `Request failed (${response.status}).`);
  }
  return result as T;
}

function eventText(event: AgentSession["events"][number]) {
  if (typeof event.payload.text === "string") return event.payload.text;
  if (typeof event.payload.output === "string") return event.payload.output;
  if (typeof event.payload.error === "string") return event.payload.error;
  if (typeof event.payload.name === "string") {
    return `${event.type === "tool.called" ? "Calling" : "Finished"} ${event.payload.name}`;
  }
  if (typeof event.payload.prompt === "string") return event.payload.prompt;
  return event.type;
}

export function AgentPanel({ workspaceId }: { workspaceId: string }) {
  const endpoint = `/api/workspaces/${workspaceId}/agents`;
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [name, setName] = useState("Atlas");
  const [prompt, setPrompt] = useState("");
  const [followUps, setFollowUps] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const result = await fetch(endpoint, { cache: "no-store" }).then(
      (response) => json<{ sessions: AgentSession[] }>(response),
    );
    setSessions(result.sessions);
  }, [endpoint]);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        await refresh();
      } catch (caught) {
        if (!stopped)
          setError(
            caught instanceof Error ? caught.message : "Agent refresh failed.",
          );
      }
      if (!stopped) window.setTimeout(() => void poll(), 1_500);
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [refresh]);

  async function createSession() {
    if (!prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, prompt }),
      }).then((response) => json(response));
      setPrompt("");
      setName(name === "Atlas" ? "Nova" : name);
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Agent start failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendFollowUp(sessionId: string) {
    const value = followUps[sessionId]?.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      await fetch(`${endpoint}/${sessionId}/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: value }),
      }).then((response) => json(response));
      setFollowUps((current) => ({ ...current, [sessionId]: "" }));
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Follow-up could not queue.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function interrupt(sessionId: string) {
    setBusy(true);
    setError("");
    try {
      await fetch(`${endpoint}/${sessionId}/interrupt`, {
        method: "POST",
      }).then((response) => json(response));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Interrupt failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="ide-changes agent-runtime-panel" aria-label="AI agents">
      <div className="agent-panel-head">
        <div>
          <span>AI agents</span>
          <b>{sessions.length}/2 worktrees</b>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh"
        >
          ↻
        </button>
      </div>
      {error ? <div className="ide-error">{error}</div> : null}
      {sessions.length < 2 ? (
        <div className="agent-compose">
          <label>
            Agent name
            <input
              value={name}
              maxLength={32}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Task
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe a repository change…"
              rows={4}
            />
          </label>
          <button
            type="button"
            disabled={busy || !prompt.trim()}
            onClick={() => void createSession()}
          >
            Start isolated agent
          </button>
        </div>
      ) : null}
      <div className="agent-session-list">
        {sessions.map((session, index) => (
          <section className="agent-session" key={session.id}>
            <div className="agent-session-top">
              <span
                className={`workspace-agent-avatar ${index === 1 ? "violet" : ""}`}
              >
                AI
              </span>
              <p>
                <strong>{session.name}</strong>
                <span>{session.model}</span>
              </p>
              <span
                className={`agent-pill ${session.status === "failed" ? "review" : ""}`}
              >
                {session.status}
              </span>
            </div>
            <div className="agent-branch">
              <span>⑂</span> {session.worktreeName}
            </div>
            <div className="agent-event-stream" aria-live="polite">
              {session.events.slice(-10).map((event) => (
                <div key={event.id}>
                  <small>{event.type}</small>
                  <p>{eventText(event)}</p>
                </div>
              ))}
              {session.events.length === 0 ? (
                <p className="ide-empty">Waiting for durable workflow…</p>
              ) : null}
            </div>
            {session.lastError ? (
              <div className="ide-error">{session.lastError}</div>
            ) : null}
            <div className="agent-follow-up">
              <textarea
                aria-label={`Follow up with ${session.name}`}
                value={followUps[session.id] ?? ""}
                onChange={(event) =>
                  setFollowUps((current) => ({
                    ...current,
                    [session.id]: event.target.value,
                  }))
                }
                placeholder="Queue a follow-up…"
                rows={2}
              />
              <div>
                <button
                  type="button"
                  disabled={busy || !followUps[session.id]?.trim()}
                  onClick={() => void sendFollowUp(session.id)}
                >
                  Queue
                </button>
                {session.status === "running" ? (
                  <button
                    className="agent-interrupt"
                    type="button"
                    disabled={busy}
                    onClick={() => void interrupt(session.id)}
                  >
                    Interrupt
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ))}
      </div>
      <div className="phase-note ide-phase-note">
        <span>Phase 6</span>
        <p>
          Durable turns, isolated worktrees, queued follow-ups, and server-side
          BYO OpenAI credentials.
        </p>
      </div>
    </aside>
  );
}
