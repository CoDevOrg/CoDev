"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type CheckpointKey =
  | "preflight"
  | "secondIdentity"
  | "realtime"
  | "terminal"
  | "twoAgents"
  | "collision"
  | "publication"
  | "defaultBranchUnchanged"
  | "feedback"
  | "teardown";

interface PilotConsoleProps {
  checkpoints: { key: CheckpointKey; label: string }[];
  metrics: {
    activeUsers7d: number;
    returningUsers7d: number;
    sharedWorkspaces7d: number;
    coSteeringRate: number;
    contestedClaims7d: number;
    publications7d: number;
    feedback7d: number;
  };
  workspaces: {
    id: string;
    repository: string;
    status: string;
    visibility: string;
    memberCount: number;
    lastActivityAt: string;
  }[];
  sessions: {
    id: string;
    workspaceId: string;
    repository: string;
    createdByLogin: string;
    status: "running" | "blocked" | "completed";
    checkpoints: Record<string, boolean>;
    blockerCategory: string | null;
    release: string;
    startedAt: string;
    completedAt: string | null;
  }[];
  feedback: {
    id: string;
    authorLogin: string;
    repository: string | null;
    category: string;
    rating: number | null;
    message: string;
    page: string | null;
    release: string | null;
    status: string;
    createdAt: string;
  }[];
}

const blockerCategories = [
  "access",
  "collaboration",
  "agent",
  "publication",
  "runtime",
  "cost",
  "other",
] as const;
const feedbackStatuses = ["new", "reviewing", "planned", "resolved"] as const;

export function PilotConsole(props: PilotConsoleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [workspaceId, setWorkspaceId] = useState(props.workspaces[0]?.id ?? "");
  const [blockers, setBlockers] = useState<Record<string, string>>(
    Object.fromEntries(
      props.sessions.map((session) => [
        session.id,
        session.blockerCategory ?? "other",
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  function mutate(url: string, method: "POST" | "PATCH", body: unknown) {
    setError(null);
    startTransition(async () => {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setError(result?.error ?? "The pilot operation failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="pilot-console" aria-busy={isPending}>
      {error ? (
        <p className="pilot-error" role="alert">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="pilot-metrics-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Last 7 days</p>
            <h2 id="pilot-metrics-heading">Product signals</h2>
          </div>
          <span>Operational metadata only</span>
        </div>
        <div className="pilot-metrics">
          <Metric label="Active users" value={props.metrics.activeUsers7d} />
          <Metric
            label="Returning users"
            value={props.metrics.returningUsers7d}
          />
          <Metric
            label="Shared workspaces"
            value={props.metrics.sharedWorkspaces7d}
          />
          <Metric
            label="Co-steering rate"
            value={`${props.metrics.coSteeringRate}%`}
          />
          <Metric
            label="Contested claims"
            value={props.metrics.contestedClaims7d}
          />
          <Metric
            label="Branches published"
            value={props.metrics.publications7d}
          />
          <Metric label="Feedback items" value={props.metrics.feedback7d} />
        </div>
      </section>

      <section className="pilot-section" aria-labelledby="pilot-runs-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Validation runs</p>
            <h2 id="pilot-runs-heading">Pilot sessions</h2>
          </div>
          <div className="pilot-create">
            <label className="sr-only" htmlFor="pilot-workspace">
              Workspace
            </label>
            <select
              id="pilot-workspace"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              {props.workspaces.map((workspace) => (
                <option value={workspace.id} key={workspace.id}>
                  {workspace.repository}
                </option>
              ))}
            </select>
            <button
              className="primary-button"
              type="button"
              disabled={isPending || !workspaceId}
              onClick={() =>
                mutate("/api/pilot/sessions", "POST", { workspaceId })
              }
            >
              Start pilot
            </button>
          </div>
        </div>

        {props.sessions.length ? (
          <div className="pilot-runs">
            {props.sessions.map((session) => {
              const complete = props.checkpoints.every(
                ({ key }) => session.checkpoints[key],
              );
              return (
                <article className="pilot-run-card" key={session.id}>
                  <header>
                    <div>
                      <strong>{session.repository}</strong>
                      <span>
                        @{session.createdByLogin} ·{" "}
                        {new Date(session.startedAt).toLocaleString()}
                      </span>
                    </div>
                    <span className={`status-pill pilot-${session.status}`}>
                      {session.status}
                    </span>
                  </header>
                  <div className="pilot-checkpoints">
                    {props.checkpoints.map((checkpoint) => (
                      <label key={checkpoint.key}>
                        <input
                          type="checkbox"
                          checked={Boolean(session.checkpoints[checkpoint.key])}
                          disabled={isPending || session.status === "completed"}
                          onChange={(event) =>
                            mutate(
                              `/api/pilot/sessions/${session.id}`,
                              "PATCH",
                              {
                                checkpoint: checkpoint.key,
                                checked: event.target.checked,
                              },
                            )
                          }
                        />
                        <span>{checkpoint.label}</span>
                      </label>
                    ))}
                  </div>
                  <footer>
                    <div className="pilot-blocker">
                      <label htmlFor={`blocker-${session.id}`}>Blocker</label>
                      <select
                        id={`blocker-${session.id}`}
                        value={blockers[session.id] ?? "other"}
                        disabled={isPending || session.status === "completed"}
                        onChange={(event) =>
                          setBlockers((current) => ({
                            ...current,
                            [session.id]: event.target.value,
                          }))
                        }
                      >
                        {blockerCategories.map((category) => (
                          <option value={category} key={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                      <button
                        className="quiet-button"
                        type="button"
                        disabled={isPending || session.status === "completed"}
                        onClick={() =>
                          mutate(`/api/pilot/sessions/${session.id}`, "PATCH", {
                            status: "blocked",
                            blockerCategory: blockers[session.id] ?? "other",
                          })
                        }
                      >
                        Mark blocked
                      </button>
                    </div>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={
                        isPending || !complete || session.status === "completed"
                      }
                      onClick={() =>
                        mutate(`/api/pilot/sessions/${session.id}`, "PATCH", {
                          status: "completed",
                          blockerCategory: null,
                        })
                      }
                    >
                      Complete pilot
                    </button>
                  </footer>
                  <small className="pilot-release">
                    Release {session.release.slice(0, 12)}
                  </small>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-card">
            <strong>No pilot sessions yet</strong>
            <p>Choose a workspace and start the first validation run.</p>
          </div>
        )}
      </section>

      <section
        className="pilot-section"
        aria-labelledby="pilot-feedback-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Design partners</p>
            <h2 id="pilot-feedback-heading">Feedback triage</h2>
          </div>
          <span>{props.feedback.length} recent</span>
        </div>
        {props.feedback.length ? (
          <div className="pilot-feedback-list">
            {props.feedback.map((item) => (
              <article key={item.id}>
                <header>
                  <span>
                    @{item.authorLogin} · {item.category}
                    {item.rating ? ` · ${item.rating}/5` : ""}
                  </span>
                  <select
                    aria-label={`Status for feedback from ${item.authorLogin}`}
                    value={item.status}
                    disabled={isPending}
                    onChange={(event) =>
                      mutate(`/api/pilot/feedback/${item.id}`, "PATCH", {
                        status: event.target.value,
                      })
                    }
                  >
                    {feedbackStatuses.map((status) => (
                      <option value={status} key={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </header>
                <p>{item.message}</p>
                <small>
                  {item.repository ?? item.page ?? "General"} ·{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-card">
            <strong>No feedback received</strong>
            <p>New design-partner submissions will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
