"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentChatTranscript } from "@/components/agent-chat-transcript";
import { mapSessionToChatItems } from "@/lib/agent-chat";

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
    createdAt?: string | Date | null;
  }[];
  events: {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    createdAt?: string | Date | null;
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

export function AgentPanel({
  workspaceId,
  canMerge,
  onTurnCompleted,
}: {
  workspaceId: string;
  canMerge: boolean;
  onTurnCompleted?: () => void;
}) {
  const endpoint = `/api/workspaces/${workspaceId}/agents`;
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [name, setName] = useState("Atlas");
  const [prompt, setPrompt] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [reviews, setReviews] = useState<Record<string, WorktreeReview>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [composingNew, setComposingNew] = useState(false);
  const turnStatusRef = useRef(new Map<string, string>());
  const onTurnCompletedRef = useRef(onTurnCompleted);

  useEffect(() => {
    onTurnCompletedRef.current = onTurnCompleted;
  }, [onTurnCompleted]);

  const activeSessionCount = sessions.filter(
    (session) =>
      session.worktreeStatus === "active" ||
      session.worktreeStatus === "frozen",
  ).length;

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ??
    sessions[0] ??
    null;

  const chatItems = useMemo(
    () => (selectedSession ? mapSessionToChatItems(selectedSession) : []),
    [selectedSession],
  );

  const refresh = useCallback(async () => {
    const result = await fetch(endpoint, { cache: "no-store" }).then(
      (response) => json<{ sessions: AgentSession[] }>(response),
    );
    setSessions(result.sessions);
    setSelectedSessionId((current) => {
      if (
        current &&
        result.sessions.some((session) => session.id === current)
      ) {
        return current;
      }
      return result.sessions[0]?.id ?? null;
    });
    if (result.sessions.length === 0) setComposingNew(true);
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

  useEffect(() => {
    let sawCompletion = false;
    for (const session of sessions) {
      for (const turn of session.turns) {
        const previous = turnStatusRef.current.get(turn.id);
        if (
          previous !== undefined &&
          previous !== "completed" &&
          turn.status === "completed"
        ) {
          sawCompletion = true;
        }
        turnStatusRef.current.set(turn.id, turn.status);
      }
    }
    if (sawCompletion) onTurnCompletedRef.current?.();
  }, [sessions]);

  async function createSession() {
    if (!prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          prompt,
          ...(issueNumber ? { issueNumber: Number(issueNumber) } : {}),
        }),
      }).then((response) => json<{ sessionId?: string }>(response));
      setPrompt("");
      setIssueNumber("");
      setName(name === "Atlas" ? "Nova" : name);
      setComposingNew(false);
      if (result.sessionId) setSelectedSessionId(result.sessionId);
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Agent start failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendFollowUp() {
    if (!selectedSession) return;
    const value = followUp.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      await fetch(`${endpoint}/${selectedSession.id}/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: value }),
      }).then((response) => json(response));
      setFollowUp("");
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

  const showNewComposer =
    composingNew || !selectedSession || activeSessionCount < 2;
  const followUpMode = Boolean(selectedSession) && !composingNew;

  return (
    <aside
      className="ide-changes agent-runtime-panel agent-chat-panel"
      aria-label="Agent chat"
    >
      <div className="agent-panel-head">
        <div>
          <span>Agent chat</span>
          <b>{activeSessionCount}/2 active</b>
        </div>
        <div className="agent-panel-head-actions">
          {activeSessionCount < 2 ? (
            <button
              type="button"
              className={composingNew ? "active" : ""}
              onClick={() => setComposingNew(true)}
              aria-label="New session"
            >
              +
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {sessions.length > 0 ? (
        <div
          className="agent-session-tabs"
          role="tablist"
          aria-label="Sessions"
        >
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              role="tab"
              aria-selected={
                session.id === selectedSession?.id && !composingNew
              }
              className={
                session.id === selectedSession?.id && !composingNew
                  ? "active"
                  : ""
              }
              onClick={() => {
                setSelectedSessionId(session.id);
                setComposingNew(false);
              }}
            >
              <strong>{session.name}</strong>
              <span>{session.status}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <div className="ide-error">{error}</div> : null}

      {selectedSession && !composingNew ? (
        <div className="agent-chat-meta">
          <span>⑂ {selectedSession.worktreeName}</span>
          {selectedSession.issueNumber ? (
            <a
              href={selectedSession.issueUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
            >
              #{selectedSession.issueNumber}
            </a>
          ) : null}
          {selectedSession.lastError ? (
            <span className="agent-chat-meta-error">
              {selectedSession.lastError}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="agent-chat-body">
        {composingNew || !selectedSession ? (
          <div className="agent-chat-welcome">
            <strong>Shared agent canvas</strong>
            <p>
              Start an isolated agent session. Everyone in the workspace sees
              the same transcript.
            </p>
          </div>
        ) : (
          <AgentChatTranscript items={chatItems} />
        )}
      </div>

      {selectedSession && !composingNew ? (
        <details className="agent-review-disclosure">
          <summary>Review &amp; merge</summary>
          {selectedSession.claims.length > 0 ? (
            <div className="agent-claims">
              <small>Path claims</small>
              {selectedSession.claims.map((claim) => (
                <p key={claim.id}>
                  <code>{claim.pathGlob}</code>
                  <span>{claim.status}</span>
                </p>
              ))}
            </div>
          ) : null}
          {selectedSession.messages.length > 0 ? (
            <div className="agent-coordination">
              <small>Coordination</small>
              {selectedSession.messages.slice(-3).map((message) => (
                <p key={message.id}>
                  <b>{message.kind.replaceAll("_", " ")}</b>
                  <span>{message.status}</span>
                </p>
              ))}
            </div>
          ) : null}
          {canMerge &&
          selectedSession.worktreeStatus !== "merged" &&
          selectedSession.worktreeStatus !== "discarded" ? (
            <div className="agent-review">
              <div className="agent-review-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void review(selectedSession.id)}
                >
                  {selectedSession.reviewedAt
                    ? "Refresh review"
                    : "Prepare review"}
                </button>
                {selectedSession.reviewedAt ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void reviewAction(selectedSession.id, "rebase")
                      }
                    >
                      Rebase
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void reviewAction(selectedSession.id, "merge")
                      }
                    >
                      Merge
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="agent-discard"
                  disabled={busy}
                  onClick={() =>
                    void reviewAction(selectedSession.id, "discard")
                  }
                >
                  Discard
                </button>
              </div>
              {reviews[selectedSession.id] ? (
                <details>
                  <summary>
                    Reviewed diff ·{" "}
                    {reviews[selectedSession.id]?.diffDigest.slice(0, 10)}
                  </summary>
                  <pre>
                    {reviews[selectedSession.id]?.diff || "No file changes."}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : (
            <div className="agent-review-result">
              {selectedSession.worktreeStatus === "merged"
                ? "Merged into the integration worktree."
                : selectedSession.worktreeStatus === "discarded"
                  ? "Worktree discarded."
                  : "Merge capability is required to review this worktree."}
            </div>
          )}
        </details>
      ) : null}

      <div className="agent-chat-composer">
        {followUpMode && selectedSession ? (
          <>
            <textarea
              aria-label={`Follow up with ${selectedSession.name}`}
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
              placeholder="Send a follow-up…"
              rows={3}
            />
            <div className="agent-chat-composer-actions">
              <button
                type="button"
                disabled={busy || !followUp.trim()}
                onClick={() => void sendFollowUp()}
              >
                Send
              </button>
              {selectedSession.status === "running" ? (
                <button
                  className="agent-interrupt"
                  type="button"
                  disabled={busy}
                  onClick={() => void interrupt(selectedSession.id)}
                >
                  Interrupt
                </button>
              ) : null}
            </div>
          </>
        ) : showNewComposer && activeSessionCount < 2 ? (
          <>
            <div className="agent-compose-fields">
              <label>
                Agent name
                <input
                  value={name}
                  maxLength={32}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                GitHub issue
                <input
                  inputMode="numeric"
                  min={1}
                  type="number"
                  value={issueNumber}
                  onChange={(event) => setIssueNumber(event.target.value)}
                  placeholder="optional"
                />
              </label>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe a repository change…"
              rows={3}
              aria-label="New agent task"
            />
            <div className="agent-chat-composer-actions">
              <button
                type="button"
                disabled={busy || !prompt.trim()}
                onClick={() => void createSession()}
              >
                Start session
              </button>
              {selectedSession ? (
                <button
                  type="button"
                  className="agent-composer-cancel"
                  onClick={() => setComposingNew(false)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="agent-chat-composer-full">
            Two active worktrees are running. Review or discard one to start
            another session.
          </p>
        )}
      </div>
    </aside>
  );
}
