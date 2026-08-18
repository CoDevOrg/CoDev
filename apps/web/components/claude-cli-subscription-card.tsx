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
          ? "Authenticate Claude Code from a terminal and make it the shared default for this organization."
          : "Authenticate Claude Code through the official CLI, then securely attach that login to your CoDev account."
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
            {connected ? "Connected and encrypted" : "Not connected"}
          </small>
        </div>
        <span
          className={`oauth-connection-state ${connected ? "is-connected" : ""}`}
        >
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <div className="oauth-connection-flow">
        <p>1. Install the CoDev CLI</p>
        <code className="oauth-device-code">npm install -g @trycodev/cli</code>
        <p>2. Log in to CoDev</p>
        <code className="oauth-device-code">codev login</code>
        <p>3. Authenticate Claude Code</p>
        <code className="oauth-device-code">
          {isOrg ? "codev claude-auth --org" : "codev claude-auth"}
        </code>
        <p>
          The last command runs the official Claude Code login and generates a
          long-lived subscription token. CoDev never asks for an Anthropic API
          key.
        </p>
      </div>
    </SettingsCard>
  );
}
