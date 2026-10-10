"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { LoaderCircle, Lock, SquareTerminal, Trash2 } from "lucide-react";
import type { Gen2Workspace } from "@codev/contracts";

import { GithubMark } from "@/components/settings/github-mark";
import {
  PHASE_LABEL,
  formatRelativeTime,
  workspacePhase,
} from "@/components/gen2/workspace-phase";

const ROLE_LABEL: Record<Gen2Workspace["role"], string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

// One shared clock for every card's "Updated …" label. The server snapshot is
// 0 so the label renders only after hydration, never mismatching the HTML.
let clock = 0;
const clockListeners = new Set<() => void>();
let clockTimer: number | undefined;

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  clockTimer ??= window.setInterval(() => {
    clock = Date.now();
    clockListeners.forEach((notify) => notify());
  }, 30_000);
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size > 0) return;
    window.clearInterval(clockTimer);
    clockTimer = undefined;
  };
}

function readClock() {
  if (!clock) clock = Date.now();
  return clock;
}

function cardNote(
  workspace: Gen2Workspace,
  deleting: boolean,
  error: string | null,
) {
  if (error) return { text: error, alert: true };
  if (deleting)
    return { text: "Removing saved files and chat history…", alert: false };
  if (workspace.status === "deleting") {
    return workspace.lastError
      ? {
          text: "Deletion did not finish. Retry deletion to continue.",
          alert: true,
        }
      : { text: "Removing saved files and chat history…", alert: false };
  }
  if (workspacePhase(workspace) === "failed") {
    return {
      text: "Couldn’t start. Open the workspace to try again.",
      alert: false,
    };
  }
  return null;
}

/**
 * One workspace on the home page, as a grid card or a list row (same markup,
 * laid out by CSS). The delete control sits beside the link, never inside it.
 */
export function WorkspaceCard({
  workspace,
  variant,
  deleting,
  error,
  deleteLocked,
  onDelete,
}: {
  workspace: Gen2Workspace;
  variant: "grid" | "list";
  deleting: boolean;
  error: string | null;
  deleteLocked: boolean;
  onDelete: () => void;
}) {
  const now = useSyncExternalStore(subscribeClock, readClock, () => 0);
  const phase = deleting ? "deleting" : workspacePhase(workspace);
  const openable = phase !== "deleting";
  const changing = phase === "starting" || phase === "stopping";
  const retry = workspace.status === "deleting";
  const note = cardNote(workspace, deleting, error);
  const repository = workspace.repository;

  const body = (
    <>
      <span className="gen2-ws-head">
        <span className="gen2-ws-icon" aria-hidden="true">
          {repository ? <GithubMark /> : <SquareTerminal />}
        </span>
        <span className="gen2-ws-main">
          <strong className="gen2-ws-name">{workspace.name}</strong>
          <span className="gen2-ws-source">
            {repository ? (
              <>
                <span className="gen2-ws-repo">{repository.fullName}</span>
                {repository.private ? (
                  <Lock aria-label="Private repository" role="img" />
                ) : null}
              </>
            ) : (
              "Blank workspace"
            )}
          </span>
        </span>
      </span>
      <span className="gen2-ws-meta">
        <span className="gen2-phase" data-phase={phase}>
          <span className="gen2-phase-dot" aria-hidden="true" />
          {PHASE_LABEL[phase]}
        </span>
        <span className="gen2-ws-updated">
          {now
            ? `Updated ${formatRelativeTime(workspace.updatedAt, now)}`
            : null}
        </span>
        <span className="gen2-ws-role" data-role={workspace.role}>
          {ROLE_LABEL[workspace.role]}
        </span>
      </span>
    </>
  );

  return (
    <div className={`gen2-ws gen2-ws-${variant}`} data-phase={phase}>
      {openable ? (
        <Link className="gen2-ws-link" href={`/gen2/${workspace.id}`}>
          {body}
        </Link>
      ) : (
        <div className="gen2-ws-link" aria-disabled="true">
          {body}
        </div>
      )}
      {workspace.role === "owner" ? (
        <button
          type="button"
          className="gen2-ws-delete"
          aria-label={
            deleting
              ? `Deleting ${workspace.name}`
              : retry
                ? `Retry deletion of ${workspace.name}`
                : `Delete ${workspace.name}`
          }
          title={
            changing
              ? `Wait until it finishes ${phase}`
              : retry
                ? "Retry deletion"
                : "Delete workspace"
          }
          disabled={deleteLocked || changing}
          data-visible={
            deleting || (retry && Boolean(workspace.lastError)) || undefined
          }
          onClick={onDelete}
        >
          {deleting ? (
            <LoaderCircle className="gen2-delete-spinner" aria-hidden="true" />
          ) : (
            <Trash2 aria-hidden="true" />
          )}
        </button>
      ) : null}
      {note ? (
        <p
          className="gen2-ws-note"
          data-alert={note.alert || undefined}
          role={note.alert ? "alert" : "status"}
        >
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
