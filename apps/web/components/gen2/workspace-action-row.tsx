"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  AppWindow,
  Ban,
  FileCode2,
  GitBranch,
  GitCompare,
  MessageSquarePlus,
  Pencil,
  Settings,
  SquareTerminal,
  Target,
  UserPlus,
} from "lucide-react";
import type { Gen2TurnItem, Gen2WorkspaceAction } from "@codev/contracts";

import {
  readWorkspaceActionOutcome,
  type WorkspaceActionOutcome,
} from "./use-workspace-action-dispatch";
import { isWorkspaceNavigation } from "./workspace-action-blocker";
import { workspaceActionCopy } from "./workspace-action-copy";
import { WORKSPACE_ACTION_OUTCOME_EVENT } from "./workspace-action-storage";
import { WorkspaceButton } from "./workspace-button";
import { useWorkspaceAgent } from "./workspace-controller";

type ActionItem = Extract<Gen2TurnItem, { kind: "workspaceAction" }>;

const ICONS: Record<Gen2WorkspaceAction["type"], ReactNode> = {
  open_file: <FileCode2 aria-hidden="true" />,
  show_changes: <GitCompare aria-hidden="true" />,
  open_review: <GitCompare aria-hidden="true" />,
  open_terminal: <SquareTerminal aria-hidden="true" />,
  open_preview: <AppWindow aria-hidden="true" />,
  rename_chat: <Pencil aria-hidden="true" />,
  switch_worktree: <GitBranch aria-hidden="true" />,
  open_branch: <GitBranch aria-hidden="true" />,
  create_branch: <GitBranch aria-hidden="true" />,
  open_share: <UserPlus aria-hidden="true" />,
  invite_members: <UserPlus aria-hidden="true" />,
  run_in_terminal: <SquareTerminal aria-hidden="true" />,
  start_chat: <MessageSquarePlus aria-hidden="true" />,
  open_settings: <Settings aria-hidden="true" />,
  update_goal: <Target aria-hidden="true" />,
};

function subscribe(onChange: () => void) {
  window.addEventListener(WORKSPACE_ACTION_OUTCOME_EVENT, onChange);
  return () =>
    window.removeEventListener(WORKSPACE_ACTION_OUTCOME_EVENT, onChange);
}

/** This tab's outcome for the item, re-read whenever one is recorded. */
function useOutcome(chatId: string | null | undefined, item: ActionItem) {
  return useSyncExternalStore(
    subscribe,
    () => (chatId ? readWorkspaceActionOutcome(chatId, item) : null),
    () => null,
  );
}

function Row({
  icon,
  muted = false,
  children,
}: {
  icon: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="gen2-action-row" data-muted={muted || undefined}>
      {icon}
      {children}
    </li>
  );
}

function NavigationRow({
  action,
  outcome,
  live,
}: {
  action: Gen2WorkspaceAction;
  outcome: WorkspaceActionOutcome | null;
  live: boolean;
}) {
  const agent = useWorkspaceAgent();
  const [failure, setFailure] = useState("");
  const copy = workspaceActionCopy(action);
  const ran = outcome?.state === "auto" || outcome?.state === "done";
  const blocker =
    !ran && agent ? agent.controller.autoRunBlocker(action) : null;
  const usable = !!agent && (action.type !== "rename_chat" || agent.canEdit);
  const reason = failure || blocker;
  return (
    <Row icon={ICONS[action.type]}>
      <span className="gen2-action-row-text">
        {ran ? copy.done : `Suggested: ${copy.ask}`}
      </span>
      {reason ? <span className="gen2-action-row-reason">{reason}</span> : null}
      {live && ran ? null : (
        <WorkspaceButton
          className="gen2-action-row-button"
          disabled={!usable}
          title={blocker ?? undefined}
          onClick={async () => {
            const result = await agent?.controller.run(action);
            setFailure(result && !result.ok ? result.message : "");
          }}
        >
          {copy.primary}
        </WorkspaceButton>
      )}
    </Row>
  );
}

function ProposalRow({
  action,
  outcome,
}: {
  action: Gen2WorkspaceAction;
  outcome: WorkspaceActionOutcome | null;
}) {
  const copy = workspaceActionCopy(action);
  const state =
    outcome?.state === "dismissed"
      ? "Dismissed"
      : outcome?.state === "done"
        ? outcome.message
        : null;
  return (
    <Row icon={ICONS[action.type]}>
      <span className="gen2-action-row-text" title={copy.ask}>
        Suggested: {copy.ask}
      </span>
      {state ? <span className="gen2-action-row-reason">{state}</span> : null}
    </Row>
  );
}

function ActionRow({
  item,
  chatId,
  actionToken,
  live,
}: {
  item: ActionItem;
  chatId: string | null | undefined;
  actionToken: string | null | undefined;
  live: boolean;
}) {
  const outcome = useOutcome(chatId, item);
  const foreign = live && item.token !== (actionToken ?? null);
  if (!item.action || foreign) {
    return (
      <Row icon={<Ban aria-hidden="true" />} muted>
        <span className="gen2-action-row-text">
          Ignored a workspace action ({item.error ?? "not from this turn"})
        </span>
      </Row>
    );
  }
  if (item.action.type === "update_goal") {
    return (
      <Row icon={ICONS.update_goal}>
        <span className="gen2-action-row-text">Marked the goal achieved</span>
      </Row>
    );
  }
  return isWorkspaceNavigation(item.action) ? (
    <NavigationRow action={item.action} outcome={outcome} live={live} />
  ) : (
    <ProposalRow action={item.action} outcome={outcome} />
  );
}

/**
 * An agent's workspace actions in its turn, always visible below the
 * activity summary. Navigation that did not run here gets an Open button;
 * proposals are listed with what this tab did about them, and are acted on
 * only from the decision cards of the turn that made them. Rows never act
 * without a click.
 */
export function WorkspaceActionRows({
  items,
  chatId,
  actionToken,
  live,
}: {
  items: ActionItem[];
  chatId: string | null | undefined;
  actionToken: string | null | undefined;
  live: boolean;
}) {
  if (!items.length) return null;
  return (
    <ul className="gen2-action-rows" aria-label="Workspace actions">
      {items.map((item) => (
        <ActionRow
          key={item.id}
          item={item}
          chatId={chatId}
          actionToken={actionToken}
          live={live}
        />
      ))}
    </ul>
  );
}
