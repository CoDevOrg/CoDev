import { CredentialForm } from "@/components/credential-form";
import { BedrockRoleForm } from "@/components/bedrock-role-form";
import {
  HostedCodexSubscriptionCard,
  parseHostedCodexNotice,
} from "@/components/hosted-codex-subscription-card";
import {
  OAuthConnectionsCard,
  parseOAuthNotice,
} from "@/components/oauth-connections-card";
import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/settings-content";
import {
  getOpenAICredentialStatus,
  getOAuthCredentialStatus,
  getProviderCredentialStatus,
} from "@/lib/credentials";
import { getHostedCodexPublicStatus } from "@/lib/hosted-codex-subscription-credentials";
import { getOAuthConfigurationStatus } from "@/lib/oauth";
import { requireUser } from "@/lib/session";

export default async function PersonalAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    oauth?: string;
    status?: string;
    hostedCodex?: string;
  }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const [
    openaiCredential,
    anthropicCredential,
    bedrockCredential,
    cursorCredential,
    claudeCredential,
    hostedCodex,
  ] = await Promise.all([
    getOpenAICredentialStatus(user.id),
    getProviderCredentialStatus("USER", user.id, "anthropic"),
    getProviderCredentialStatus("USER", user.id, "bedrock"),
    getProviderCredentialStatus("USER", user.id, "cursor"),
    getOAuthCredentialStatus("USER", user.id, "anthropic"),
    getHostedCodexPublicStatus({
      scopeType: "USER",
      scopeId: user.id,
      canManage: true,
    }),
  ]);

  return (
    <div className="settings-page">
      <SettingsPageHeader
        description="Connect private provider keys used for the agent turns you author. CoDev does not bill for model tokens — use your own Codex, Claude, or Cursor credentials."
        eyebrow="Personal settings"
        title="Coding agents"
      />
      <SettingsCard
        description="Your personal key takes priority over organization fallback credentials."
        title="OpenAI"
      >
        <CredentialForm
          currentLastFour={openaiCredential?.lastFour ?? undefined}
        />
        <div className="security-callout">
          <strong>Security boundary</strong>
          <p>
            CoDev encrypts credentials before storage and never returns the full
            key to the browser or sends it to a sandbox.
          </p>
        </div>
      </SettingsCard>
      <SettingsCard
        description="Use Anthropic API billing for the agent turns you author."
        title="Anthropic"
      >
        <CredentialForm
          currentLastFour={anthropicCredential?.lastFour}
          provider="anthropic"
        />
      </SettingsCard>
      <SettingsCard
        description="Use your Cursor API key so agent turns bill to your Cursor plan via the Cursor SDK."
        title="Cursor"
      >
        <CredentialForm
          currentLastFour={cursorCredential?.lastFour}
          provider="cursor"
        />
      </SettingsCard>
      <OAuthConnectionsCard
        connected={{
          claude: claudeCredential?.credentialType === "OAUTH_TOKEN",
          codex: false,
        }}
        configured={{
          claude: getOAuthConfigurationStatus("claude").configured,
          codex: false,
        }}
        flowModes={{
          claude: getOAuthConfigurationStatus("claude").flowMode,
        }}
        notice={parseOAuthNotice(params)}
        providers={["claude"]}
        returnTo="/settings/personal/agents"
      />
      <HostedCodexSubscriptionCard
        notice={parseHostedCodexNotice(params)}
        returnTo="/settings/personal/agents"
        status={hostedCodex}
      />
      <SettingsCard
        description="Use an IAM role for Amazon Bedrock instead of storing an AWS secret."
        title="Amazon Bedrock"
      >
        <BedrockRoleForm currentRole={bedrockCredential?.awsRoleArn} />
      </SettingsCard>
    </div>
  );
}
