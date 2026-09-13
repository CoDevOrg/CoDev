"use client";

import { useState } from "react";
import { KeyRound, X } from "lucide-react";

import type {
  WorkspaceAgent,
  WorkspaceProviderPreflight,
} from "@/lib/provider-surface-capability";

const SETTINGS_HREF = "/settings/personal/providers#coding-workspaces";

const AGENT_LABEL: Record<WorkspaceAgent, string> = {
  claude: "Claude",
  codex: "Codex",
};

function fixFor(agent: WorkspaceAgent) {
  return `add an API key or run codev ${agent}-auth`;
}

/**
 * The provider line a member sees as a coding workspace starts. It names the
 * agent the default chat tab opens with and, when an agent they connected for
 * chat rooms cannot run here (a browser subscription never reaches the shared
 * host), says so and names the fix — instead of letting the agent boot to
 * "Not logged in". While starting it always shows; once the workspace is up it
 * stays only when there is something to act on, and can be dismissed.
 */
export function ProviderPreflightBanner({
  preflight,
  phase,
}: {
  preflight: WorkspaceProviderPreflight;
  phase: "starting" | "ready";
}) {
  const [dismissed, setDismissed] = useState(false);
  const gaps = preflight.notReady.filter((entry) => entry.connectedForRooms);
  const actionable = preflight.starting === null || gaps.length > 0;

  if (phase === "ready" && (!actionable || dismissed)) return null;

  let headline: string;
  let detail: string | null = null;
  if (preflight.starting === null) {
    headline = "No agent is set up for coding workspaces yet.";
    detail =
      gaps.length > 0
        ? `${gaps.map((gap) => AGENT_LABEL[gap.agent]).join(" and ")} ${
            gaps.length > 1 ? "are" : "is"
          } connected for chat rooms only. To use ${
            gaps.length > 1 ? "them" : "it"
          } here, ${fixFor(gaps[0]!.agent)}.`
        : `${fixFor("claude")} (or codex-auth) in Settings › Coding workspaces.`;
  } else if (gaps.length > 0) {
    const gap = gaps[0]!;
    headline = `Starting ${AGENT_LABEL[preflight.starting]}.`;
    detail = `${AGENT_LABEL[gap.agent]} is connected for chat rooms but not for coding workspaces — ${fixFor(gap.agent)} to use it here.`;
  } else if (preflight.startingSource === "shared") {
    headline = `Starting ${AGENT_LABEL[preflight.starting]}…`;
    detail = `Running on this workspace's shared ${AGENT_LABEL[preflight.starting]} login — every member here can use it.`;
  } else {
    headline = `Starting ${AGENT_LABEL[preflight.starting]}…`;
  }

  return (
    <div
      className="workspace-provider-preflight"
      role="status"
      aria-live="polite"
      data-testid="provider-preflight"
    >
      <KeyRound aria-hidden className="workspace-provider-preflight-icon" />
      <div className="workspace-provider-preflight-body">
        <p className="workspace-provider-preflight-headline">{headline}</p>
        {detail ? (
          <p className="workspace-provider-preflight-detail">
            {detail}{" "}
            {actionable ? (
              <a href={SETTINGS_HREF}>Open provider settings</a>
            ) : null}
          </p>
        ) : null}
      </div>
      {phase === "ready" ? (
        <button
          aria-label="Dismiss"
          className="workspace-provider-preflight-dismiss"
          onClick={() => setDismissed(true)}
          type="button"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
