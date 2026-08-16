"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SettingsCard } from "@/components/settings/settings-content";
import type { HostedCodexPublicStatus } from "@/lib/hosted-codex-subscription-view";

export function parseHostedCodexNotice(params: {
  hostedCodex?: string;
}): { status: string; text: string } | undefined {
  switch (params.hostedCodex) {
    case "connected":
      return {
        status: "connected",
        text: "Codex subscription is connected. CoDev stores only encrypted server-side material.",
      };
    case "denied":
      return {
        status: "denied",
        text: "Codex connection was cancelled. You can try again whenever you are ready.",
      };
    case "unavailable":
      return {
        status: "unavailable",
        text: "Hosted Codex subscription connection is not enabled yet.",
      };
    case "error":
      return {
        status: "error",
        text: "Codex sign-in did not complete. Start Connect again from this page.",
      };
    default:
      return undefined;
  }
}

export function HostedCodexSubscriptionCard({
  status,
  organizationId,
  returnTo,
  notice,
}: {
  status: HostedCodexPublicStatus;
  organizationId?: string;
  returnTo: string;
  notice?: { status: string; text: string } | undefined;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isOrg = status.scopeType === "ORGANIZATION";
  const connectHref = (() => {
    const query = new URLSearchParams({
      returnTo,
      scopeType: status.scopeType,
    });
    if (isOrg && organizationId) {
      query.set("organizationId", organizationId);
      query.set("confirmOrganizationScope", "true");
    }
    return `/api/auth/hosted-codex?${query.toString()}`;
  })();

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

  const canConnect =
    status.enabled &&
    status.configured &&
    status.canManage &&
    (!isOrg || confirmed);

  return (
    <SettingsCard
      description={
        isOrg
          ? "An organization Codex subscription is a shared default for this workspace. Personal connections still take priority."
          : "Connect your eligible Codex subscription for cloud workspaces you start. CoDev never pastes an API key and never shows tokens in the browser."
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
      <p>
        This connection powers isolated cloud workspaces. Review CoDev&apos;s{" "}
        <Link href="/legal/privacy">privacy notice</Link> and{" "}
        <Link href="/legal/retention">data retention policy</Link> before
        connecting. You can disconnect at any time from this page.
      </p>
      {isOrg ? (
        <p>
          Organization scope is selected. Only a workspace maintainer can
          connect or disconnect this shared subscription.
        </p>
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
        {status.canManage ? (
          status.enabled && status.configured ? (
            <div className="hosted-codex-actions">
              {isOrg ? (
                <label className="hosted-codex-confirm">
                  <input
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  Confirm organization-wide use before connecting
                </label>
              ) : null}
              {status.status === "connected" ||
              status.status === "reauthorization_required" ? (
                <>
                  <Link
                    className="secondary-button"
                    href={canConnect ? connectHref : "#"}
                    aria-disabled={!canConnect}
                  >
                    Reconnect
                  </Link>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void disconnect()}
                    type="button"
                  >
                    {busy ? "Disconnecting…" : "Disconnect"}
                  </button>
                </>
              ) : (
                <Link
                  className="secondary-button"
                  href={canConnect ? connectHref : "#"}
                  aria-disabled={!canConnect}
                >
                  Connect Codex subscription
                </Link>
              )}
            </div>
          ) : (
            <span className="oauth-connection-unavailable">
              {status.enabled
                ? "Approved client configuration required"
                : "Waiting for OpenAI-hosted approval"}
            </span>
          )
        ) : (
          <span className="oauth-connection-unavailable">Status only</span>
        )}
      </div>
    </SettingsCard>
  );
}
