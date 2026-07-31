import Link from "next/link";

import { CredentialForm } from "@/components/credential-form";
import { BedrockRoleForm } from "@/components/bedrock-role-form";
import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/settings-content";
import {
  getOpenAICredentialStatus,
  getProviderCredentialStatus,
} from "@/lib/credentials";
import { requireUser } from "@/lib/session";

export default async function PersonalAgentsPage() {
  const user = await requireUser();
  const [openaiCredential, anthropicCredential, bedrockCredential] =
    await Promise.all([
      getOpenAICredentialStatus(user.id),
      getProviderCredentialStatus("USER", user.id, "anthropic"),
      getProviderCredentialStatus("USER", user.id, "bedrock"),
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
      <SettingsCard
        description="Connect subscription OAuth credentials for Claude Code and Codex."
        title="OAuth connections"
      >
        <div className="form-actions">
          <Link className="primary-button" href="/api/auth/oauth/claude">
            Connect Claude Code
          </Link>
          <Link className="primary-button" href="/api/auth/oauth/codex">
            Connect Codex
          </Link>
        </div>
      </SettingsCard>
      <SettingsCard
        description="Use an IAM role for Amazon Bedrock instead of storing an AWS secret."
        title="Amazon Bedrock"
      >
        <BedrockRoleForm currentRole={bedrockCredential?.awsRoleArn} />
      </SettingsCard>
    </div>
  );
}
