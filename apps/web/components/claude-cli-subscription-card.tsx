import { SettingsCard } from "@/components/settings/settings-content";

export function ClaudeCliSubscriptionCard({
  connected,
  isOrg = false,
}: {
  connected: boolean;
  isOrg?: boolean;
}) {
  return (
    <SettingsCard
      description={
        isOrg
          ? "Claude subscriptions are personal and cannot be shared with an organization."
          : "Connect through official Claude login in personal provider settings. Credentials stay in a private runtime profile."
      }
      title={
        isOrg
          ? "Organization Claude Code subscription"
          : "Personal Claude Code subscription"
      }
    >
      <div className="oauth-connection-card">
        <div className="oauth-connection-card-copy">
          <strong>
            {isOrg ? "Organization default" : "Your Claude Code subscription"}
          </strong>
          <small>
            {connected
              ? "Signed in to a private runtime"
              : "Reconnect using official Claude login"}
          </small>
        </div>
        <span
          className={`oauth-connection-state ${connected ? "is-connected" : ""}`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <div className="oauth-connection-flow">
        <p>
          Open personal Settings → Providers and select Connect for Claude Code.
          Existing token-based connections must reconnect. CoDev no longer
          accepts subscription token uploads.
        </p>
      </div>
    </SettingsCard>
  );
}
