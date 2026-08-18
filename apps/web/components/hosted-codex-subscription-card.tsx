"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SettingsCard } from "@/components/settings/settings-content";
import type { HostedCodexPublicStatus } from "@/lib/hosted-codex-subscription-view";
import type { HostedCodexNotice } from "@/lib/settings-notices";

export function HostedCodexSubscriptionCard({
  status,
  organizationId,
  notice,
}: {
  status: HostedCodexPublicStatus;
  organizationId?: string;
  returnTo: string;
  notice?: HostedCodexNotice | undefined;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isOrg = status.scopeType === "ORGANIZATION";

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/auth/hosted-codex/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeType: status.scopeType,
        organizationId,
      }),
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
          ? "Authenticate Codex from a terminal and make it the shared default for this organization."
          : "Authenticate Codex through the official CLI, then securely attach that login to your CoDev account."
      }
      title={
        isOrg
          ? "Organization Codex subscription"
          : "Personal Codex subscription"
      }
    >
      {notice ? (
        <div
          className={`oauth-connection-notice ${notice.status === "connected" ? "is-success" : "is-warning"}`}
          role={notice.status === "connected" ? "status" : "alert"}
        >
          {notice.text}
        </div>
      ) : null}
      {message ? (
        <div className="oauth-connection-notice is-warning" role="alert">
          {message}
        </div>
      ) : null}
      <div className="oauth-connection-card">
        <div className="oauth-connection-card-copy">
          <strong>
            {isOrg ? "Organization default" : "Your Codex subscription"}
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
          <p>3. Authenticate Codex</p>
          <code className="oauth-device-code">
            {isOrg ? "codev codex-auth --org" : "codev codex-auth"}
          </code>
          <p>
            The last command runs the official Codex device login. CoDev never
            asks for an OpenAI API key.
          </p>
          {status.status === "connected" ||
          status.status === "reauthorization_required" ? (
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
