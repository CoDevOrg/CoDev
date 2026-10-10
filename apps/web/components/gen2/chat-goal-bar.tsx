"use client";

import { Target } from "lucide-react";
import type { Gen2ChatGoal } from "@codev/contracts";

import { Switch } from "@/components/ui/switch";
import {
  GOAL_CONTINUE_PROMPT,
  MAX_GOAL_TURNS,
  type GoalContinuation,
} from "./use-goal-continuation";
import { WorkspaceButton } from "./workspace-button";

function KeepGoing({ continuation }: { continuation: GoalContinuation }) {
  return (
    <span className="gen2-chat-goal-keep">
      <Switch
        checked={continuation.enabled}
        onCheckedChange={continuation.setEnabled}
        aria-label="Keep going"
      />
      <span aria-hidden="true">Keep going</span>
      {continuation.enabled && continuation.turns > 0 ? (
        <span>
          Turn {continuation.turns} of {MAX_GOAL_TURNS}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The chat's goal above the composer, with Continue, Mark done and Clear,
 * and for editors an opt-in "Keep going" that continues on its own.
 */
export function ChatGoalBar({
  goal,
  canEdit,
  busy,
  continuation,
  onSend,
}: {
  goal: Gen2ChatGoal;
  canEdit: boolean;
  busy: boolean;
  continuation: GoalContinuation;
  onSend: (prompt: string) => void;
}) {
  const active = goal.status === "active";
  return (
    <section
      className="gen2-chat-goal"
      aria-label="Chat goal"
      data-status={goal.status}
    >
      <Target aria-hidden="true" />
      <div className="gen2-chat-goal-body">
        <span className="gen2-chat-goal-text" title={goal.text}>
          {goal.text}
        </span>
        <span
          className="gen2-chat-goal-status"
          title={goal.summary ?? undefined}
        >
          {active ? "Active" : "Achieved"}
          {goal.summary ? ` · ${goal.summary}` : ""}
        </span>
      </div>
      {canEdit ? (
        <div className="gen2-chat-goal-actions">
          {continuation.countdown !== null ? (
            <>
              <span role="status">Continuing in {continuation.countdown}s</span>
              <WorkspaceButton
                aria-label="Stop continuing"
                onClick={continuation.stop}
              >
                Stop
              </WorkspaceButton>
            </>
          ) : active ? (
            <>
              <WorkspaceButton
                disabled={busy}
                onClick={() => onSend(GOAL_CONTINUE_PROMPT)}
              >
                Continue
              </WorkspaceButton>
              <WorkspaceButton
                disabled={busy}
                onClick={() => onSend("/goal done")}
              >
                Mark done
              </WorkspaceButton>
            </>
          ) : null}
          <WorkspaceButton
            disabled={busy}
            onClick={() => onSend("/goal clear")}
          >
            Clear
          </WorkspaceButton>
          {active ? <KeepGoing continuation={continuation} /> : null}
        </div>
      ) : null}
    </section>
  );
}
