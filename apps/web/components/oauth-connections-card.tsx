import Link from "next/link";

import { SettingsCard } from "@/components/settings/settings-content";

type OAuthProvider = "claude" | "codex";
type OAuthStatus = "connected" | "denied" | "error" | "not_configured";

export type OAuthNotice = {
  provider: OAuthProvider;
  status: OAuthStatus;
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

function clientIdVariable(provider: OAuthProvider) {
  return provider === "claude"
    ? "CLAUDE_OAUTH_CLIENT_ID"
    : "CODEX_OAUTH_CLIENT_ID";
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
        text: `${label} is not available yet. An administrator must add ${clientIdVariable(notice.provider)} and register this app's callback URL before it can be connected.`,
      };
    default:
      return {
        role: "alert" as const,
        className: "oauth-connection-notice is-warning",
        text: `${label} sign-in did not complete. Check the provider setup and try again.`,
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
  notice,
  returnTo,
  scopeType = "USER",
  workspaceId,
}: {
  connected: Record<OAuthProvider, boolean>;
  configured: Record<OAuthProvider, boolean>;
  notice?: OAuthNotice | undefined;
  returnTo: string;
  scopeType?: "USER" | "WORKSPACE";
  workspaceId?: string | undefined;
}) {
  const noticeDetails = notice ? noticeCopy(notice) : null;

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
      <div className="oauth-connection-grid">
        {(["claude", "codex"] as const).map((provider) => {
          const label = providerLabel(provider);
          const isConnected = connected[provider];
          const isConfigured = configured[provider];
          return (
            <div className="oauth-connection-card" key={provider}>
              <div className="oauth-connection-card-copy">
                <strong>{label}</strong>
                <small>
                  {isConnected
                    ? "Connected and encrypted"
                    : isConfigured
                      ? "Not connected"
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
                <span className="oauth-connection-unavailable">
                  Waiting for setup
                </span>
              )}
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}
