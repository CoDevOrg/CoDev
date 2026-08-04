import { CredentialForm } from "@/components/credential-form";
import { BedrockRoleForm } from "@/components/bedrock-role-form";
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
import { getOAuthConfigurationStatus } from "@/lib/oauth";
import { requireUser } from "@/lib/session";

export default async function PersonalAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth?: string; status?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const [
    openaiCredential,
    anthropicCredential,
    bedrockCredential,
    codexCredential,
    claudeCredential,
  ] = await Promise.all([
    getOpenAICredentialStatus(user.id),
    getProviderCredentialStatus("USER", user.id, "anthropic"),
    getProviderCredentialStatus("USER", user.id, "bedrock"),
    getOAuthCredentialStatus("USER", user.id, "openai"),
    getOAuthCredentialStatus("USER", user.id, "anthropic"),
  ]);

  return (
    <div className="settings-page">
      <SettingsPageHeader
        description="Connect private provider keys used for the agent turns you author."
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
      <OAuthConnectionsCard
        connected={{
          claude: claudeCredential?.credentialType === "OAUTH_TOKEN",
          codex: codexCredential?.credentialType === "OAUTH_TOKEN",
        }}
        configured={{
          claude: getOAuthConfigurationStatus("claude").configured,
          codex: getOAuthConfigurationStatus("codex").configured,
        }}
        notice={parseOAuthNotice(params)}
        returnTo="/settings/personal/agents"
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
