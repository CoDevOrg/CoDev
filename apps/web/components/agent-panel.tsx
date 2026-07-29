"use client";

import { useCallback, useEffect, useState } from "react";

type AgentSession = {
  id: string;
  name: string;
  model: string;
  status: string;
  worktreeName: string;
  worktreeStatus: "active" | "frozen" | "merged" | "discarded";
  issueNumber: number | null;
  issueTitle: string | null;
  issueUrl: string | null;
  reviewHeadSha: string | null;
  reviewBaseSha: string | null;
  reviewDiffDigest: string | null;
  reviewedAt: string | null;
  mergedAt: string | null;
  discardedAt: string | null;
  lastError: string | null;
  claims: {
    id: string;
    pathGlob: string;
    intent: string;
    status: string;
  }[];
  messages: {
    id: string;
    kind: string;
    status: string;
    fromSessionId: string;
    toSessionId: string;
    payload: Record<string, unknown>;
  }[];
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

type WorktreeReview = {
  baseSha: string;
  headSha: string;
  diff: string;
  diffDigest: string;
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

export function AgentPanel({
  workspaceId,
  canMerge,
}: {
  workspaceId: string;
  canMerge: boolean;
}) {
  const endpoint = `/api/workspaces/${workspaceId}/agents`;
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [name, setName] = useState("Atlas");
  const [prompt, setPrompt] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [followUps, setFollowUps] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<Record<string, WorktreeReview>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeSessionCount = sessions.filter(
    (session) =>
      session.worktreeStatus === "active" ||
      session.worktreeStatus === "frozen",
  ).length;

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
        body: JSON.stringify({
          name,
          prompt,
          ...(issueNumber ? { issueNumber: Number(issueNumber) } : {}),
        }),
      }).then((response) => json(response));
      setPrompt("");
      setIssueNumber("");
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

  async function review(sessionId: string) {
    setBusy(true);
    setError("");
    try {
      const result = await fetch(`${endpoint}/${sessionId}/review`, {
        method: "POST",
      }).then((response) => json<{ review: WorktreeReview }>(response));
      setReviews((current) => ({
        ...current,
        [sessionId]: result.review,
      }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review failed.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewAction(
    sessionId: string,
    action: "rebase" | "merge" | "discard",
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await fetch(`${endpoint}/${sessionId}/${action}`, {
        method: "POST",
      }).then((response) =>
        json<{ review?: WorktreeReview; status?: string }>(response),
      );
      if (result.review) {
        setReviews((current) => ({
          ...current,
          [sessionId]: result.review!,
        }));
      }
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : `${action[0]?.toUpperCase()}${action.slice(1)} failed.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="ide-changes agent-runtime-panel" aria-label="AI agents">
      <div className="agent-panel-head">
        <div>
          <span>AI agents</span>
          <b>{activeSessionCount}/2 active worktrees</b>
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
      {activeSessionCount < 2 ? (
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
            GitHub issue (optional)
            <input
              inputMode="numeric"
              min={1}
              type="number"
              value={issueNumber}
              onChange={(event) => setIssueNumber(event.target.value)}
              placeholder="123"
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
            {session.issueNumber ? (
              <a
                className="agent-issue"
                href={session.issueUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
              >
                #{session.issueNumber} · {session.issueTitle ?? "GitHub issue"}
              </a>
            ) : null}
            {session.claims.length > 0 ? (
              <div className="agent-claims">
                <small>Path claims</small>
                {session.claims.map((claim) => (
                  <p key={claim.id}>
                    <code>{claim.pathGlob}</code>
                    <span>{claim.status}</span>
                  </p>
                ))}
              </div>
            ) : null}
            {session.messages.length > 0 ? (
              <div className="agent-coordination">
                <small>Coordination</small>
                {session.messages.slice(-3).map((message) => (
                  <p key={message.id}>
                    <b>{message.kind.replaceAll("_", " ")}</b>
                    <span>{message.status}</span>
                  </p>
                ))}
              </div>
            ) : null}
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
            {canMerge &&
            session.worktreeStatus !== "merged" &&
            session.worktreeStatus !== "discarded" ? (
              <div className="agent-review">
                <div>
                  <strong>Review worktree</strong>
                  <span>
                    Stable checkpoint, revision guard, and capability-gated
                    decision.
                  </span>
                </div>
                <div className="agent-review-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void review(session.id)}
                  >
                    {session.reviewedAt ? "Refresh review" : "Prepare review"}
                  </button>
                  {session.reviewedAt ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void reviewAction(session.id, "rebase")}
                      >
                        Rebase
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void reviewAction(session.id, "merge")}
                      >
                        Merge
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="agent-discard"
                    disabled={busy}
                    onClick={() => void reviewAction(session.id, "discard")}
                  >
                    Discard
                  </button>
                </div>
                {reviews[session.id] ? (
                  <details>
                    <summary>
                      Reviewed diff ·{" "}
                      {reviews[session.id]?.diffDigest.slice(0, 10)}
                    </summary>
                    <pre>{reviews[session.id]?.diff || "No file changes."}</pre>
                  </details>
                ) : null}
              </div>
            ) : (
              <div className="agent-review-result">
                {session.worktreeStatus === "merged"
                  ? "Merged into the integration worktree."
                  : session.worktreeStatus === "discarded"
                    ? "Worktree discarded."
                    : "Merge capability is required to review this worktree."}
              </div>
            )}
          </section>
        ))}
      </div>
      <div className="phase-note ide-phase-note">
        <span>Phase 7</span>
        <p>
          Exact issue ownership, path claims, agent negotiation, conflict
          resolution, and revision-checked review decisions.
        </p>
      </div>
    </aside>
  );
}
