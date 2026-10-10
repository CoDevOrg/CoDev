"use client";

import { Loader2, X } from "lucide-react";
import {
  GEN2_AGENT_PROVIDERS,
  type Gen2WorkspaceAction,
} from "@codev/contracts";

import { branchBaseFor } from "./create-worktree";
import { workspaceActionCopy } from "./workspace-action-copy";
import { NO_CODEV_ACCOUNT } from "./workspace-action-invite";
import { WorkspaceButton } from "./workspace-button";
import type { WorkspaceActionResult } from "./workspace-controller";

/** Where the member is, for wording a card truthfully. */
export type WorkspaceActionCardPlace = {
  worktreeId: string;
  branch: string;
  worktrees: Array<{ worktreeId: string; branch: string }>;
};

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function branchOf(place: WorkspaceActionCardPlace, worktreeId: string) {
  return (
    place.worktrees.find((worktree) => worktree.worktreeId === worktreeId)
      ?.branch ?? worktreeId
  );
}

/** Exactly what accepting the request does; nothing the card cannot keep. */
function detailFor(
  action: Gen2WorkspaceAction,
  place: WorkspaceActionCardPlace,
  blocker: string | null,
) {
  switch (action.type) {
    case "invite_members":
      return `Adds ${action.people.join(", ")} as ${action.role} now — immediate access to code, terminals and agents.`;
    case "create_branch": {
      const current = { worktreeId: place.worktreeId, branch: place.branch };
      const base = branchBaseFor(current, place.worktrees, action.baseRef);
      return `Create ${action.branch} from ${base.label} in a new worktree and switch to it. Uncommitted changes stay on ${place.branch}.`;
    }
    case "run_in_terminal": {
      const target = action.worktreeId ?? place.worktreeId;
      return target === place.worktreeId
        ? `Runs in a new terminal on ${place.branch}.`
        : `Runs on ${branchOf(place, target)}. Its terminal tab appears when you switch there.`;
    }
    case "switch_worktree":
      return `Switch to ${branchOf(place, action.worktreeId)}. Your terminal on ${place.branch} closes.`;
    case "open_branch":
      return `Opens ${action.branch} in a worktree of its own and switches to it.`;
    case "start_chat": {
      const agent =
        GEN2_AGENT_PROVIDERS.find((entry) => entry.id === action.provider)
          ?.label ?? "the current agent";
      return `Starts a new chat with ${agent}, linked to this one. Nothing is sent until you press Send.`;
    }
    case "open_share":
      return action.emailOrLogin
        ? `Opens Share with ${action.emailOrLogin} filled in.`
        : "Opens Share.";
    case "open_settings":
      return "Opens Settings, where you connect agent accounts.";
    default:
      return blocker;
  }
}

/** A command meant for a worktree the member is not on. */
function runsElsewhere(
  action: Gen2WorkspaceAction,
  place: WorkspaceActionCardPlace,
) {
  return (
    action.type === "run_in_terminal" &&
    action.worktreeId !== undefined &&
    action.worktreeId !== place.worktreeId
  );
}

/** The agent-authored text a card shows verbatim, in full. */
function quoted(action: Gen2WorkspaceAction) {
  if (action.type === "run_in_terminal") return action.command;
  if (action.type === "start_chat") return action.prompt;
  return null;
}

function Results({
  result,
  onOpenShare,
}: {
  result: WorkspaceActionResult;
  onOpenShare(person: string): void;
}) {
  return (
    <div className="gen2-action-card-result" role="status">
      <p data-ok={result.ok}>{result.message}</p>
      {result.details?.length ? (
        <ul>
          {result.details.map((detail) => (
            <li key={detail.person} data-ok={detail.ok}>
              <span className="gen2-action-card-person">{detail.person}</span>
              <span>{detail.message}</span>
              {detail.message === NO_CODEV_ACCOUNT ? (
                <WorkspaceButton
                  tone="ghost"
                  onClick={() => onOpenShare(detail.person)}
                >
                  Open Share to copy the invite link
                </WorkspaceButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type CardHandlers = {
  onRun(): void;
  onSwitchAndRun(): void;
  onOpenShare(person: string): void;
  onDismiss(): void;
};

type WorkspaceActionCardProps = CardHandlers & {
  action: Gen2WorkspaceAction;
  blocker: string | null;
  position: string | null;
  place: WorkspaceActionCardPlace;
  canEdit: boolean;
  busy: boolean;
  result: WorkspaceActionResult | null;
};

type CardActionsProps = Omit<CardHandlers, "onOpenShare"> & {
  ask: string;
  primary: string;
  done: boolean;
  elsewhere: boolean;
  canEdit: boolean;
  busy: boolean;
};

function CardActions(props: CardActionsProps) {
  const { ask, primary, done, elsewhere, canEdit, busy } = props;
  const disabled = !canEdit || busy;
  return (
    <div className="gen2-action-card-actions">
      {!done && elsewhere ? (
        <WorkspaceButton
          tone="primary"
          disabled={disabled}
          onClick={props.onSwitchAndRun}
        >
          Switch and run
        </WorkspaceButton>
      ) : null}
      {done ? null : (
        <WorkspaceButton
          tone={elsewhere ? "secondary" : "primary"}
          disabled={disabled}
          onClick={props.onRun}
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : null}
          {primary}
        </WorkspaceButton>
      )}
      <WorkspaceButton
        size="icon"
        aria-label={done ? "Close" : `Dismiss request to ${ask}`}
        disabled={busy}
        onClick={props.onDismiss}
      >
        <X aria-hidden="true" />
      </WorkspaceButton>
    </div>
  );
}

/**
 * One agent request waiting for the member, in the dock above the composer.
 * The primary button does exactly what the card says; Dismiss records that
 * it was not done. Viewers see the request but cannot act on it.
 */
export function WorkspaceActionCard({
  action,
  blocker,
  position,
  place,
  canEdit,
  busy,
  result,
  onOpenShare,
  ...handlers
}: WorkspaceActionCardProps) {
  const copy = workspaceActionCopy(action);
  const text = quoted(action);
  const done = result?.ok === true;
  const elsewhere = runsElsewhere(action, place);
  return (
    <section
      className="gen2-action-card"
      aria-label={`Agent request: ${copy.ask}`}
      data-done={done || undefined}
    >
      <div className="gen2-action-card-body">
        <p className="gen2-action-card-meta">
          Agent request{position ? ` · ${position}` : ""}
        </p>
        <p className="gen2-action-card-title">{capitalize(copy.ask)}</p>
        {text ? <pre className="gen2-action-card-quote">{text}</pre> : null}
        <p className="gen2-action-card-detail">
          {detailFor(action, place, blocker)}
        </p>
        {canEdit ? null : (
          <p className="gen2-action-card-detail">
            Only editors can act on agent requests.
          </p>
        )}
        {result ? <Results result={result} onOpenShare={onOpenShare} /> : null}
      </div>
      <CardActions
        {...handlers}
        ask={copy.ask}
        primary={copy.primary}
        done={done}
        elsewhere={elsewhere}
        canEdit={canEdit}
        busy={busy}
      />
    </section>
  );
}
