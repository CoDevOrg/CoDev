import "server-only";

import type { Gen2PossibleDuplicateTask } from "@codev/contracts";

import { isGen2AgentCoordinationEnabled } from "./agent-coordination-feature";
import { listGen2AgentSessions } from "./agent-sessions";
import { listGen2SupersetRuns } from "./superset-runs";

const ACTIVE_STATUSES = new Set(["creating", "running"]);
const MIN_SHARED_WORDS = 3;
const MIN_SHARED_RATIO = 0.6;
const MAX_TASK_CHARS = 500;
const STOP_WORDS = new Set(
  (
    "the and for with that this from into onto our your you are was were will would " +
    "could should can please make sure need want use using also all any but not its " +
    "has have them then than when what which who why how there their these those " +
    "about after before just only some such more most other very code file files " +
    "add update change changes work task"
  ).split(" "),
);

function taskWords(text: string) {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (word) => word.length >= 3 && !STOP_WORDS.has(word),
    ),
  );
}

/**
 * Lexical only: tasks never leave CoDev for this check. Two tasks look alike
 * when they share at least three meaningful words making up most of the
 * shorter task.
 */
export function tasksLookAlike(left: string, right: string) {
  const leftWords = taskWords(left);
  const rightWords = taskWords(right);
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  const shorter = Math.min(leftWords.size, rightWords.size);
  return (
    shared >= MIN_SHARED_WORDS &&
    shorter > 0 &&
    shared / shorter >= MIN_SHARED_RATIO
  );
}

/**
 * The first active agent session in another chat whose task looks like this
 * prompt. It reads only CoDev's records, never wakes a guest, and treats any
 * failure as no match, so it can delay a start for confirmation but never
 * prevent one.
 */
export async function findPossibleDuplicateTask(input: {
  workspaceId: string;
  chatId: string;
  prompt: string;
}): Promise<Gen2PossibleDuplicateTask | undefined> {
  if (!isGen2AgentCoordinationEnabled(input.workspaceId)) return undefined;
  try {
    const [runs, sessions] = await Promise.all([
      listGen2SupersetRuns(input.workspaceId),
      listGen2AgentSessions(input.workspaceId),
    ]);
    const tasks = new Map(
      sessions.map((session) => [session.id, session.task]),
    );
    const match = runs
      .filter(
        (run) =>
          ACTIVE_STATUSES.has(run.status) &&
          run.chatId !== input.chatId &&
          run.sessionId !== null,
      )
      .map((run) => ({ run, task: tasks.get(run.sessionId ?? "") ?? "" }))
      .find(({ task }) => task && tasksLookAlike(input.prompt, task));
    if (!match) return undefined;
    return {
      runId: match.run.id,
      worktreeId: match.run.worktreeId,
      provider: match.run.provider,
      createdBy: match.run.createdBy,
      status: match.run.status,
      task: match.task.slice(0, MAX_TASK_CHARS),
    };
  } catch {
    return undefined;
  }
}
