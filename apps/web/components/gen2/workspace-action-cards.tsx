"use client";

import { useState } from "react";
import type { Gen2WorkspaceAction } from "@codev/contracts";

import type { PendingWorkspaceAction } from "./use-workspace-action-dispatch";
import {
  WorkspaceActionCard,
  type WorkspaceActionCardPlace,
} from "./workspace-action-card";
import {
  useWorkspaceAgent,
  type WorkspaceActionResult,
  type WorkspaceAgentContextValue,
} from "./workspace-controller";

const VISIBLE = 3;

type Resolve = (
  key: string,
  outcome: "done" | "dismissed",
  message?: string,
) => void;

function placeOf(agent: WorkspaceAgentContextValue): WorkspaceActionCardPlace {
  const snapshot = agent.getSnapshot();
  const worktreeId = snapshot?.worktree.id ?? agent.sources.worktreeId;
  return {
    worktreeId,
    branch: snapshot?.worktree.branch ?? worktreeId,
    worktrees:
      snapshot?.worktrees.map((worktree) => ({
        worktreeId: worktree.id,
        branch: worktree.branch,
      })) ?? [],
  };
}

/** For a command meant for another worktree: switch there, then run it. */
function switchThenRun(entry: PendingWorkspaceAction): Gen2WorkspaceAction[] {
  const target =
    "worktreeId" in entry.action ? entry.action.worktreeId : undefined;
  return target
    ? [{ type: "switch_worktree", worktreeId: target }, entry.action]
    : [entry.action];
}

/**
 * Runs a card's action(s) in order and keeps the result on screen after the
 * request is resolved, so per-person invite results stay readable until the
 * member closes the card.
 */
function useCardRunner(
  agent: WorkspaceAgentContextValue | null,
  onResolve: Resolve,
) {
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, WorkspaceActionResult>>(
    {},
  );
  const [finished, setFinished] = useState<PendingWorkspaceAction[]>([]);

  async function run(
    entry: PendingWorkspaceAction,
    steps: Gen2WorkspaceAction[],
  ) {
    if (!agent || busy) return;
    setBusy(entry.key);
    let result: WorkspaceActionResult = { ok: false, message: "" };
    for (const step of steps) {
      result = await agent.controller.run(step);
      if (!result.ok) break;
    }
    setBusy(null);
    setResults((current) => ({ ...current, [entry.key]: result }));
    if (!result.ok) return;
    setFinished((current) => [...current, entry]);
    onResolve(entry.key, "done", result.message);
  }

  function close(entry: PendingWorkspaceAction) {
    if (finished.some((other) => other.key === entry.key)) {
      setFinished((current) =>
        current.filter((other) => other.key !== entry.key),
      );
    } else {
      onResolve(entry.key, "dismissed");
    }
  }

  return { busy, results, finished, run, close };
}

/**
 * Decision cards for an agent's requests, in the dock above the composer:
 * the first three, each with "n of N". Each acts only on a click, never on
 * its own.
 */
export function WorkspaceActionCards({
  pending,
  onResolve,
}: {
  pending: PendingWorkspaceAction[];
  onResolve(key: string, outcome: "done" | "dismissed", message?: string): void;
}) {
  const agent = useWorkspaceAgent();
  const runner = useCardRunner(agent, onResolve);
  if (!agent) return null;
  const activeChatId = agent.sources.activeChatId;
  const finished = runner.finished.filter(
    (entry) => entry.chatId === activeChatId,
  );
  const open = pending.filter(
    (entry) => !finished.some((other) => other.key === entry.key),
  );
  const cards = [...finished, ...open];
  if (!cards.length) return null;
  const place = placeOf(agent);
  return (
    <div className="gen2-action-cards">
      {cards.slice(0, VISIBLE).map((entry, index) => (
        <WorkspaceActionCard
          key={entry.key}
          action={entry.action}
          blocker={entry.blocker}
          position={cards.length > 1 ? `${index + 1} of ${cards.length}` : null}
          place={place}
          canEdit={agent.canEdit}
          busy={runner.busy === entry.key}
          result={runner.results[entry.key] ?? null}
          onRun={() => void runner.run(entry, [entry.action])}
          onSwitchAndRun={() => void runner.run(entry, switchThenRun(entry))}
          onOpenShare={(person) =>
            void agent.controller.run({
              type: "open_share",
              emailOrLogin: person,
            })
          }
          onDismiss={() => runner.close(entry)}
        />
      ))}
    </div>
  );
}
