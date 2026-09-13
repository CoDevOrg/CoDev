"use client";

import { useState } from "react";
import { KeyRound, X } from "lucide-react";

import {
  AGENT_LABEL,
  WORKSPACE_PROVIDER_SETTINGS_HREF as SETTINGS_HREF,
  workspaceProviderFix as fixFor,
  type WorkspaceAgent,
  type WorkspaceProviderPreflight,
} from "@/lib/provider-surface-capability";

/**
 * The provider line a member sees as a coding workspace starts. It names the
 * agent the default chat tab opens with and, when an agent they connected for
 * chat rooms cannot run here (a browser subscription never reaches the shared
 * host), says so and names the fix — instead of letting the agent boot to
 * "Not logged in". It waits for the workspace shell so setup guidance never
 * obscures boot progress, then appears as a compact, dismissible card only
 * when there is something to act on.
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

  if (phase === "starting" || !actionable || dismissed) return null;

  let headline: string;
  let detail: string | null = null;
  if (preflight.starting === null) {
    headline = "Set up a coding agent";
    detail =
      gaps.length > 0
        ? `${gaps.map((gap) => AGENT_LABEL[gap.agent]).join(" and ")} ${
            gaps.length > 1 ? "are" : "is"
          } connected to rooms only. To use ${
            gaps.length > 1 ? "them" : "it"
          } in this workspace, ${fixFor(gaps[0]!.agent)}.`
        : `Connect Claude or Codex in Settings to start coding here.`;
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
    <aside
      className="provider-preflight"
      role="status"
      aria-live="polite"
      data-testid="provider-preflight"
    >
      <span className="provider-preflight-icon" aria-hidden="true">
        <KeyRound size={16} strokeWidth={1.8} />
      </span>
      <div className="provider-preflight-copy">
        <p className="provider-preflight-title">{headline}</p>
        {detail ? (
          <p className="provider-preflight-detail">
            {detail}{" "}
            {actionable ? (
              <a className="provider-preflight-link" href={SETTINGS_HREF}>
                Set up agent
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
      <button
        aria-label="Dismiss"
        className="provider-preflight-dismiss"
        onClick={() => setDismissed(true)}
        type="button"
      >
        <X aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
    </aside>
  );
}
