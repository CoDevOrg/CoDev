"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SettingsCard } from "@/components/settings/settings-content";
import type { ClaudeCliTokenPublicStatus } from "@/lib/providers/claude-cli-token-view";

/**
 * The `codev claude-auth` setup-token — Claude's coding-workspace login.
 * Mirrors `HostedCodexSubscriptionCard` so the two providers' org-sharing UI
 * present identically: a personal login is private; an `--org` login is
 * shared with every member of that workspace, shown here plainly rather than
 * only warned about once at connect time.
 */
export function ClaudeCliSubscriptionCard({
  status,
  organizationId,
}: {
  status: ClaudeCliTokenPublicStatus;
  organizationId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isOrg = status.scopeType === "ORGANIZATION";

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/auth/claude-cli-token/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeType: status.scopeType, organizationId }),
    });
    if (!response.ok) {
      setMessage("Disconnect failed. Try again from this page.");
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <SettingsCard
      description={
        isOrg
          ? "Authenticate Claude from a terminal and share it with every member of this workspace's coding workspaces."
          : "Authenticate Claude through the official CLI, then securely attach that login to your CoDev account."
      }
      title={
        isOrg ? "Workspace Claude Code login" : "Personal Claude Code login"
      }
    >
      {message ? (
        <div className="oauth-connection-notice is-warning" role="alert">
          {message}
        </div>
      ) : null}
      {isOrg && status.status === "connected" ? (
        <div className="oauth-connection-notice is-warning" role="status">
          Shared: every member of this workspace can run Claude in their coding
          workspace on this login.
        </div>
      ) : null}
      <div className="oauth-connection-card">
        <div className="oauth-connection-card-copy">
          <strong>
            {isOrg ? "Workspace default" : "Your Claude Code login"}
          </strong>
          <small>{status.stateText}</small>
        </div>
        <span
          className={`oauth-connection-state ${status.status === "connected" ? "is-connected" : ""}`}
        >
          {status.status === "connected" ? "Connected" : "Not connected"}
        </span>
        {!status.canManage ? (
          <span className="oauth-connection-unavailable">Status only</span>
        ) : null}
      </div>
      {status.canManage ? (
        <div className="oauth-connection-flow">
          <p>1. Install the CoDev CLI</p>
          <code className="oauth-device-code">
            npm install -g @trycodev/cli
          </code>
          <p>2. Log in to CoDev</p>
          <code className="oauth-device-code">codev login</code>
          <p>3. Authenticate Claude</p>
          <code className="oauth-device-code">
            {isOrg ? "codev claude-auth --org" : "codev claude-auth"}
          </code>
          <p>
            The last command runs the official Claude Code login and asks{" "}
            {isOrg
              ? "for confirmation before sharing it with this workspace."
              : "for nothing beyond that — CoDev never sees your password."}
          </p>
          {status.status === "connected" ? (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void disconnect()}
              type="button"
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : null}
        </div>
      ) : null}
    </SettingsCard>
  );
}
