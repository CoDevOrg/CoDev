"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ChevronDown,
  FileCode2,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";

import { AgentChatTranscript } from "@/components/agent-chat-transcript";
import {
  mapAgentEventToChatEvent,
  mapSessionToChatItems,
} from "@/lib/agent-chat";
import { deriveAgentSessionName } from "@/lib/agent-session-name";
import type { AgentEvent } from "@codev/shared-types";

export type AgentSession = {
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
  reviewedAt: string | Date | null;
  mergedAt: string | Date | null;
  discardedAt: string | Date | null;
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
  canReview = canMerge,
  canSteer = true,
  initialSessions = [],
  initialStateEvents = [],
  onTurnCompleted,
}: {
  workspaceId: string;
  canMerge: boolean;
  canReview?: boolean;
  canSteer?: boolean;
  initialSessions?: AgentSession[];
  initialStateEvents?: AgentEvent[];
  onTurnCompleted?: () => void;
}) {
  const endpoint = `/api/workspaces/${workspaceId}/agents`;
  const [sessions, setSessions] = useState<AgentSession[]>(initialSessions);
  const [stateEvents, setStateEvents] = useState<AgentEvent[]>(
    initialStateEvents ?? [],
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [prompt, setPrompt] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [reviews, setReviews] = useState<Record<string, WorktreeReview>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentPath, setCommentPath] = useState("");
  const [commentLine, setCommentLine] = useState("");
  const [composingNew, setComposingNew] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>(() => [
    ...new Set([initialSessions[0]?.model ?? "gpt-5"]),
  ]);
  const [selectedModel, setSelectedModel] = useState(
    initialSessions[0]?.model ?? "gpt-5",
  );
  const turnStatusRef = useRef(new Map<string, string>());
  const modelOptionsLoadedRef = useRef(false);
  const onTurnCompletedRef = useRef(onTurnCompleted);
  const composerFocusedRef = useRef(false);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    onTurnCompletedRef.current = onTurnCompleted;
  }, [onTurnCompleted]);

  useEffect(() => {
    if (composerFocusedRef.current) return;
    const node = composerTextareaRef.current;
    if (!node) return;
    composerFocusedRef.current = true;
    const frame = window.requestAnimationFrame(() => node.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [sessions, composingNew, selectedSessionId]);

  const activeSessionCount = sessions.filter(
    (session) =>
      session.worktreeStatus === "active" ||
      session.worktreeStatus === "frozen",
  ).length;

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ??
    sessions[0] ??
    null;

  const chatItems = useMemo(() => {
    if (!selectedSession) return [];
    const durableEvents = stateEvents
      .filter((event) => event.sessionId === selectedSession.id)
      .map(mapAgentEventToChatEvent);
    return mapSessionToChatItems(
      durableEvents.length > 0
        ? { ...selectedSession, events: durableEvents }
        : selectedSession,
    );
  }, [selectedSession, stateEvents]);

  const refresh = useCallback(async () => {
    const includeModels = !modelOptionsLoadedRef.current;
    const result = await fetch(
      `${endpoint}${includeModels ? "?includeModels=true" : ""}`,
      { cache: "no-store" },
    ).then((response) =>
      json<{
        sessions: AgentSession[];
        stateEvents?: AgentEvent[];
        models?: string[];
      }>(response),
    );
    setSessions(result.sessions);
    setStateEvents(result.stateEvents ?? []);
    if (includeModels) modelOptionsLoadedRef.current = true;
    if (result.models?.length) {
      setModelOptions(result.models);
      setSelectedModel((current) =>
        result.models?.includes(current)
          ? current
          : (result.models?.[0] ?? current),
      );
    }
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
    if (!canSteer) return;
    const value = prompt.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      const result = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: deriveAgentSessionName(value),
          prompt: value,
          model: selectedModel,
        }),
      }).then((response) => json<{ sessionId?: string }>(response));
      setPrompt("");
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

  function onComposerKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    submit: () => void,
  ) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (!busy) submit();
  }

  async function sendFollowUp() {
    if (!canSteer) return;
    if (!selectedSession) return;
    const value = followUp.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      await fetch(`${endpoint}/${selectedSession.id}/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: value, model: selectedModel }),
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
    if (!canSteer) return;
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

  async function addComment() {
    if (!canReview || !selectedSession || !commentBody.trim()) return;
    const lineNumber = commentLine.trim()
      ? Number.parseInt(commentLine.trim(), 10)
      : undefined;
    if (
      lineNumber !== undefined &&
      (!Number.isInteger(lineNumber) || lineNumber < 1)
    ) {
      setError("A comment line must be a positive integer.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await fetch(`/api/workspaces/${workspaceId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: commentBody.trim(),
          filePath: commentPath.trim() || undefined,
          lineNumber,
          sessionId: selectedSession.id,
        }),
      }).then((response) => json(response));
      setCommentBody("");
      setCommentPath("");
      setCommentLine("");
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Comment could not be saved.",
      );
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
    canSteer && (composingNew || !selectedSession || activeSessionCount < 2);
  const followUpMode = Boolean(selectedSession) && !composingNew;

  return (
    <section className="agent-panel-layout" aria-label="Workspace chat">
      <aside className="agent-session-sidebar" aria-label="Chat sessions">
        <div className="agent-sidebar-title">
          <span className="agent-sidebar-mark" aria-hidden="true">
            <Sparkles />
          </span>
          <div>
            <strong>Chats</strong>
            <span>{activeSessionCount} active</span>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh chats"
          >
            <RefreshCw />
          </button>
        </div>

        {canSteer && activeSessionCount < 2 ? (
          <button
            type="button"
            className={`agent-new-session ${composingNew ? "active" : ""}`}
            onClick={() => setComposingNew(true)}
          >
            <Plus aria-hidden="true" />
            <span>New session</span>
          </button>
        ) : null}

        <div className="agent-session-group-label">
          <span>Recent</span>
          <b>{sessions.length}</b>
        </div>

        {sessions.length > 0 ? (
          <div
            className="agent-session-list"
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
                  setSelectedModel(session.model);
                  setComposingNew(false);
                }}
              >
                <MessageSquare aria-hidden="true" />
                <span>
                  <strong>{session.name}</strong>
                  <small>{session.status}</small>
                </span>
                <i className={`session-status status-${session.status}`} />
              </button>
            ))}
          </div>
        ) : (
          <p className="agent-sidebar-empty">Your chats will appear here.</p>
        )}

        <div className="agent-sidebar-foot">
          <GitBranch aria-hidden="true" />
          <span>Up to 2 parallel sessions</span>
        </div>
      </aside>

      <section
        className="ide-changes agent-runtime-panel agent-chat-panel agent-conversation"
        aria-label="Agent conversation"
      >
        <header className="agent-conversation-head">
          <div>
            <strong>
              {composingNew || !selectedSession
                ? "New session"
                : selectedSession.name}
            </strong>
            <span>
              {composingNew || !selectedSession
                ? "Describe what you want to build"
                : `${selectedSession.model} · ${selectedSession.status}`}
            </span>
          </div>
          {selectedSession && !composingNew ? (
            <span
              className={`conversation-status status-${selectedSession.status}`}
            >
              <i />
              {selectedSession.status}
            </span>
          ) : null}
        </header>

        {error ? <div className="ide-error">{error}</div> : null}

        {selectedSession && !composingNew ? (
          <div className="agent-chat-meta">
            <span>
              <GitBranch aria-hidden="true" />
              {selectedSession.worktreeName}
            </span>
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
              <strong>What should we build?</strong>
              <p>
                Describe a change below. The agent works in an isolated
                worktree; everyone in this workspace sees the same chat.
              </p>
            </div>
          ) : (
            <AgentChatTranscript items={chatItems} />
          )}
        </div>

        {selectedSession && !composingNew && (canReview || canMerge) ? (
          <details className="agent-review-disclosure">
            <summary>
              <span className="agent-review-summary-icon">
                <GitPullRequest aria-hidden="true" />
              </span>
              <span>
                <strong>Review changes</strong>
                <small>Inspect the agent&apos;s work before merging</small>
              </span>
              <ChevronDown
                className="agent-review-chevron"
                aria-hidden="true"
              />
            </summary>
            {canReview &&
            selectedSession.worktreeStatus !== "merged" &&
            selectedSession.worktreeStatus !== "discarded" ? (
              <div className="agent-review">
                <div className="agent-review-intro">
                  <div>
                    <FileCode2 aria-hidden="true" />
                    <span>
                      <strong>Check the proposed changes</strong>
                      <small>
                        Generate a diff, leave notes, then merge when it looks
                        right.
                      </small>
                    </span>
                  </div>
                </div>
                <div className="agent-review-actions">
                  <button
                    type="button"
                    className="agent-review-primary"
                    disabled={busy}
                    onClick={() => void review(selectedSession.id)}
                  >
                    <GitPullRequest aria-hidden="true" />
                    {selectedSession.reviewedAt
                      ? "Refresh review"
                      : "Prepare review"}
                  </button>
                  {canMerge && selectedSession.reviewedAt ? (
                    <>
                      <button
                        type="button"
                        className="agent-review-secondary"
                        disabled={busy}
                        onClick={() =>
                          void reviewAction(selectedSession.id, "rebase")
                        }
                      >
                        Rebase
                      </button>
                      <button
                        type="button"
                        className="agent-review-merge"
                        disabled={busy}
                        onClick={() =>
                          void reviewAction(selectedSession.id, "merge")
                        }
                      >
                        Merge
                      </button>
                    </>
                  ) : null}
                  {canMerge ? (
                    <button
                      type="button"
                      className="agent-discard"
                      disabled={busy}
                      onClick={() =>
                        void reviewAction(selectedSession.id, "discard")
                      }
                    >
                      <Trash2 aria-hidden="true" />
                      Discard changes
                    </button>
                  ) : null}
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
                {canReview ? (
                  <div className="agent-review-comment">
                    <div className="agent-review-comment-title">
                      <MessageSquareText aria-hidden="true" />
                      <span>
                        <strong>Leave a review note</strong>
                        <small>
                          Point to a file or line when the feedback is specific.
                        </small>
                      </span>
                    </div>
                    <div className="agent-review-comment-location">
                      <input
                        aria-label="Comment file path"
                        value={commentPath}
                        onChange={(event) => setCommentPath(event.target.value)}
                        placeholder="src/file.ts (optional)"
                      />
                      <input
                        aria-label="Comment line number"
                        inputMode="numeric"
                        value={commentLine}
                        onChange={(event) => setCommentLine(event.target.value)}
                        placeholder="Line"
                      />
                    </div>
                    <textarea
                      aria-label="Review comment"
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      placeholder="Leave an inline review note without running an agent…"
                      rows={3}
                    />
                    <button
                      type="button"
                      disabled={busy || !commentBody.trim()}
                      onClick={() => void addComment()}
                    >
                      <MessageSquareText aria-hidden="true" />
                      {busy ? "Saving note…" : "Add note"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="agent-review-result">
                {selectedSession.worktreeStatus === "merged"
                  ? "Merged into the integration worktree."
                  : selectedSession.worktreeStatus === "discarded"
                    ? "Worktree discarded."
                    : "Reviewer capability is required to inspect this worktree."}
              </div>
            )}
          </details>
        ) : null}

        <div className="agent-chat-composer">
          {!canSteer ? (
            <p className="agent-chat-composer-full">
              Read-only workspace access. A Co-Steer member can send prompts or
              interrupt an agent.
            </p>
          ) : followUpMode && selectedSession ? (
            <>
              <textarea
                ref={composerTextareaRef}
                aria-label={`Message ${selectedSession.name}`}
                value={followUp}
                onChange={(event) => setFollowUp(event.target.value)}
                onKeyDown={(event) =>
                  onComposerKeyDown(event, () => void sendFollowUp())
                }
                placeholder="Message the agent…"
                rows={3}
              />
              <div className="agent-chat-composer-actions">
                <div className="agent-composer-tools">
                  <button
                    type="button"
                    onClick={() => setComposingNew(true)}
                    aria-label="Start a new session"
                    title="New session"
                  >
                    <Plus />
                  </button>
                  <label className="agent-model-select">
                    <span className="sr-only">Agent model</span>
                    <select
                      aria-label="Agent model"
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                    >
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </label>
                  <kbd>⌘ Enter</kbd>
                </div>
                <button
                  type="button"
                  className="agent-send"
                  disabled={busy || !followUp.trim()}
                  onClick={() => void sendFollowUp()}
                  aria-label="Send message"
                >
                  <Send />
                </button>
                {selectedSession.status === "running" ? (
                  <button
                    className="agent-interrupt"
                    type="button"
                    disabled={busy}
                    onClick={() => void interrupt(selectedSession.id)}
                  >
                    <Square />
                    Stop
                  </button>
                ) : null}
              </div>
            </>
          ) : showNewComposer && activeSessionCount < 2 ? (
            <>
              <textarea
                ref={composerTextareaRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) =>
                  onComposerKeyDown(event, () => void createSession())
                }
                placeholder="Ask the agent to build something…"
                rows={3}
                aria-label="Message the agent"
              />
              <div className="agent-chat-composer-actions">
                <div className="agent-composer-tools">
                  <label className="agent-model-select">
                    <span className="sr-only">Agent model</span>
                    <select
                      aria-label="Agent model"
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                    >
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </label>
                  <kbd>⌘ Enter</kbd>
                </div>
                <button
                  type="button"
                  className="agent-send"
                  disabled={busy || !prompt.trim()}
                  onClick={() => void createSession()}
                  aria-label="Start session"
                >
                  <Send />
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
      </section>
    </section>
  );
}
