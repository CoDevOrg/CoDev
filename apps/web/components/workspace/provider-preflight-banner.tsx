"use client";

import { useState } from "react";
import { KeyRound, X } from "lucide-react";

import {
  AGENT_LABEL,
  WORKSPACE_PROVIDER_SETTINGS_HREF as SETTINGS_HREF,
  workspaceProviderFix as fixFor,
  type WorkspaceProviderPreflight,
} from "@/lib/providers/provider-surface-capability";

/**
 * Secondary notice when a workspace already has a runnable agent, but another
 * one the member connected for chat rooms cannot run here. First-visit setup
 * (nothing connected yet, or rooms-only with no workspace agent) lives in the
 * IDE empty state so the member never has to leave the workspace to start.
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
  const starting = preflight.starting;

  if (phase === "starting" || !starting || gaps.length === 0 || dismissed) {
    return null;
  }

  const gap = gaps[0]!;

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
        <p className="provider-preflight-title">
          Starting {AGENT_LABEL[starting]}.
        </p>
        <p className="provider-preflight-detail">
          {AGENT_LABEL[gap.agent]} is connected for chat rooms but not for
          coding workspaces — {fixFor(gap.agent)} to use it here.{" "}
          <a className="provider-preflight-link" href={SETTINGS_HREF}>
            Set up agent
          </a>
        </p>
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
