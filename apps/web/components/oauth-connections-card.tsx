"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";

import { SettingsCard } from "@/components/settings/settings-content";

type OAuthProvider = "claude" | "codex";
type OAuthStatus = "connected" | "denied" | "error" | "not_configured";
type OAuthFlowMode = "app_callback" | "manual_code" | "device_code";

export type OAuthNotice = {
  provider: OAuthProvider;
  status: OAuthStatus;
};

type ProviderSession =
  | {
      provider: "claude";
      mode: "manual_code";
      authorizeUrl: string;
    }
  | {
      provider: "codex";
      mode: "device_code";
      verificationUrl: string;
      userCode: string;
      deviceAuthId: string;
      intervalSeconds: number;
    }
  | {
      provider: OAuthProvider;
      mode: "app_callback";
      authorizeUrl: string;
    };

export function parseOAuthNotice(params: {
  oauth?: string;
  status?: string;
}): OAuthNotice | undefined {
  if (
    (params.oauth !== "claude" && params.oauth !== "codex") ||
    !["connected", "denied", "error", "not_configured"].includes(
      params.status ?? "",
    )
  ) {
    return undefined;
  }

  return {
    provider: params.oauth,
    status: params.status as OAuthStatus,
  };
}

function providerLabel(provider: OAuthProvider) {
  return provider === "claude" ? "Claude Code" : "Codex";
}

function noticeCopy(notice: OAuthNotice) {
  const label = providerLabel(notice.provider);
  switch (notice.status) {
    case "connected":
      return {
        role: "status" as const,
        className: "oauth-connection-notice is-success",
        text: `${label} is connected. Its token is encrypted and ready for agent sessions.`,
      };
    case "denied":
      return {
        role: "status" as const,
        className: "oauth-connection-notice",
        text: `${label} connection was cancelled. You can try again whenever you're ready.`,
      };
    case "not_configured":
      return {
        role: "alert" as const,
        className: "oauth-connection-notice is-warning",
        text: `${label} is not available yet. Check provider OAuth configuration and try again.`,
      };
    default:
      return {
        role: "alert" as const,
        className: "oauth-connection-notice is-warning",
        text: `${label} sign-in did not complete. Start Connect again from this page.`,
      };
  }
}

function connectionHref({
  provider,
  scopeType,
  workspaceId,
  returnTo,
}: {
  provider: OAuthProvider;
  scopeType: "USER" | "WORKSPACE";
  workspaceId?: string | undefined;
  returnTo: string;
}) {
  const query = new URLSearchParams({ returnTo });
  if (scopeType === "WORKSPACE" && workspaceId) {
    query.set("scopeType", scopeType);
    query.set("workspaceId", workspaceId);
  }
  return `/api/auth/oauth/${provider}?${query.toString()}`;
}

export function OAuthConnectionsCard({
  connected,
  configured,
  flowModes,
  notice,
  returnTo,
  scopeType = "USER",
  workspaceId,
}: {
  connected: Record<OAuthProvider, boolean>;
  configured: Record<OAuthProvider, boolean>;
  flowModes?: Partial<Record<OAuthProvider, OAuthFlowMode>>;
  notice?: OAuthNotice | undefined;
  returnTo: string;
  scopeType?: "USER" | "WORKSPACE";
  workspaceId?: string | undefined;
}) {
  const router = useRouter();
  const noticeDetails = notice ? noticeCopy(notice) : null;
  const [active, setActive] = useState<ProviderSession | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [message, setMessage] = useState<{
    text: string;
    tone: "success" | "warning";
  } | null>(null);
  const [busy, setBusy] = useState<OAuthProvider | null>(null);

  const onDevicePending = useEffectEvent(async (session: {
    deviceAuthId: string;
    userCode: string;
  }) => {
    const response = await fetch("/api/auth/oauth/codex/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceAuthId: session.deviceAuthId,
        userCode: session.userCode,
      }),
    });
    const payload = (await response.json()) as {
      status?: string;
      error?: string;
    };
    if (!response.ok) {
      setMessage({
        text: payload.error ?? "Codex authorization failed.",
        tone: "warning",
      });
      setActive(null);
      setBusy(null);
      return "stop" as const;
    }
    if (payload.status === "connected") {
      setMessage({ text: "Codex is connected.", tone: "success" });
      setActive(null);
      setBusy(null);
      router.refresh();
      return "stop" as const;
    }
    return "continue" as const;
  });

  useEffect(() => {
    if (!active || active.mode !== "device_code") return;
    const deviceAuthId = active.deviceAuthId;
    const userCode = active.userCode;
    const intervalMs = Math.max(active.intervalSeconds, 2) * 1000;
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      const result = await onDevicePending({ deviceAuthId, userCode });
      if (result === "stop") cancelled = true;
    }

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, onDevicePending]);

  async function startConnect(provider: OAuthProvider) {
    const mode = flowModes?.[provider] ?? "app_callback";
    setMessage(null);
    setManualCode("");

    if (mode === "app_callback") {
      window.location.assign(
        connectionHref({ provider, returnTo, scopeType, workspaceId }),
      );
      return;
    }

    setBusy(provider);
    const response = await fetch(`/api/auth/oauth/${provider}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        returnTo,
        scopeType,
        workspaceId,
      }),
    });
    const payload = (await response.json()) as ProviderSession & {
      error?: string;
    };
    if (!response.ok) {
      setMessage({
        text: payload.error ?? `${providerLabel(provider)} could not start.`,
        tone: "warning",
      });
      setBusy(null);
      return;
    }

    if (payload.mode === "manual_code" && "authorizeUrl" in payload) {
      window.open(payload.authorizeUrl, "_blank", "noopener,noreferrer");
      setActive({
        provider: "claude",
        mode: "manual_code",
        authorizeUrl: payload.authorizeUrl,
      });
      setBusy(null);
      return;
    }

    if (payload.mode === "device_code" && "userCode" in payload) {
      setActive({
        provider: "codex",
        mode: "device_code",
        verificationUrl: payload.verificationUrl,
        userCode: payload.userCode,
        deviceAuthId: payload.deviceAuthId,
        intervalSeconds: payload.intervalSeconds,
      });
      return;
    }

    if (payload.mode === "app_callback" && "authorizeUrl" in payload) {
      window.location.assign(payload.authorizeUrl);
      return;
    }

    setMessage({
      text: `${providerLabel(provider)} returned an unexpected session.`,
      tone: "warning",
    });
    setBusy(null);
  }

  async function submitManualCode() {
    setBusy("claude");
    setMessage(null);
    const response = await fetch("/api/auth/oauth/claude/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: manualCode }),
    });
    const payload = (await response.json()) as {
      status?: string;
      error?: string;
    };
    if (!response.ok) {
      setMessage({
        text: payload.error ?? "Claude Code authorization failed.",
        tone: "warning",
      });
      setBusy(null);
      return;
    }
    setMessage({ text: "Claude Code is connected.", tone: "success" });
    setActive(null);
    setManualCode("");
    setBusy(null);
    router.refresh();
  }

  return (
    <SettingsCard
      description="Connect a subscription account for agent sessions without putting provider tokens in a sandbox."
      title="OAuth connections"
    >
      {noticeDetails ? (
        <div className={noticeDetails.className} role={noticeDetails.role}>
          {noticeDetails.text}
        </div>
      ) : null}
      {message ? (
        <div
          className={`oauth-connection-notice ${message.tone === "success" ? "is-success" : "is-warning"}`}
          role={message.tone === "success" ? "status" : "alert"}
        >
          {message.text}
        </div>
      ) : null}
      <div className="oauth-connection-grid">
        {(["claude", "codex"] as const).map((provider) => {
          const label = providerLabel(provider);
          const isConnected = connected[provider];
          const isConfigured = configured[provider];
          const mode = flowModes?.[provider] ?? "app_callback";
          return (
            <div className="oauth-connection-card" key={provider}>
              <div className="oauth-connection-card-copy">
                <strong>{label}</strong>
                <small>
                  {isConnected
                    ? "Connected and encrypted"
                    : isConfigured
                      ? mode === "device_code"
                        ? "ChatGPT device sign-in"
                        : mode === "manual_code"
                          ? "Paste code after browser sign-in"
                          : "Not connected"
                      : "Provider setup required"}
                </small>
              </div>
              <span
                className={`oauth-connection-state ${isConnected ? "is-connected" : ""}`}
              >
                {isConnected
                  ? "Connected"
                  : isConfigured
                    ? "Not connected"
                    : "Setup required"}
              </span>
              {isConfigured ? (
                mode === "app_callback" ? (
                  <Link
                    className="secondary-button"
                    href={connectionHref({
                      provider,
                      returnTo,
                      scopeType,
                      workspaceId,
                    })}
                  >
                    {isConnected ? "Reconnect" : "Connect"}
                  </Link>
                ) : (
                  <button
                    className="secondary-button"
                    disabled={busy === provider}
                    onClick={() => void startConnect(provider)}
                    type="button"
                  >
                    {busy === provider
                      ? "Starting…"
                      : isConnected
                        ? "Reconnect"
                        : "Connect"}
                  </button>
                )
              ) : (
                <span className="oauth-connection-unavailable">
                  Waiting for setup
                </span>
              )}
            </div>
          );
        })}
      </div>

      {active?.mode === "manual_code" ? (
        <div className="oauth-connection-flow">
          <p>
            Finish signing in with Anthropic in the new tab, then paste the
            authorization code here.
          </p>
          <div className="oauth-connection-flow-row">
            <input
              aria-label="Claude authorization code"
              onChange={(event) => setManualCode(event.target.value)}
              placeholder="Paste code (or code#state)"
              value={manualCode}
            />
            <button
              className="secondary-button"
              disabled={busy === "claude" || !manualCode.trim()}
              onClick={() => void submitManualCode()}
              type="button"
            >
              {busy === "claude" ? "Saving…" : "Save connection"}
            </button>
          </div>
          <button
            className="text-button"
            onClick={() => {
              setActive(null);
              setManualCode("");
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {active?.mode === "device_code" ? (
        <div className="oauth-connection-flow">
          <p>
            Open{" "}
            <a
              href={active.verificationUrl}
              rel="noreferrer"
              target="_blank"
            >
              {active.verificationUrl}
            </a>{" "}
            and enter this one-time code. Keep this page open until CoDev
            finishes connecting.
          </p>
          <code className="oauth-device-code">{active.userCode}</code>
          <p className="oauth-connection-flow-status">
            Waiting for ChatGPT authorization…
          </p>
          <button
            className="text-button"
            onClick={() => {
              setActive(null);
              setBusy(null);
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </SettingsCard>
  );
}
