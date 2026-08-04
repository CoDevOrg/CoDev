import { BedrockRoleForm } from "@/components/bedrock-role-form";
import {
  OAuthConnectionsCard,
  parseOAuthNotice,
} from "@/components/oauth-connections-card";
import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
  SettingsCard,
} from "@/components/settings/settings-content";
import { WorkspaceCredentialForm } from "@/components/workspace-credential-form";
import {
  getOAuthCredentialStatus,
  getProviderCredentialStatus,
} from "@/lib/credentials";
import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { getOAuthConfigurationStatus } from "@/lib/oauth";
import { requireUser } from "@/lib/session";

export default async function OrganizationAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth?: string; status?: string }>;
}) {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);
  const params = await searchParams;
  const credentials = context
    ? await Promise.all([
        getProviderCredentialStatus(
          "WORKSPACE",
          context.workspace.id,
          "openai",
        ),
        getProviderCredentialStatus(
          "WORKSPACE",
          context.workspace.id,
          "anthropic",
        ),
        getProviderCredentialStatus(
          "WORKSPACE",
          context.workspace.id,
          "bedrock",
        ),
        getOAuthCredentialStatus("WORKSPACE", context.workspace.id, "openai"),
        getOAuthCredentialStatus(
          "WORKSPACE",
          context.workspace.id,
          "anthropic",
        ),
      ])
    : [null, null, null, null, null];

  return (
    <OrganizationSettingsPage
      context={context}
      description="Manage shared provider keys and the fallback credential pool for your workspace."
      title="Coding agents"
    >
      {context ? (
        <>
          <OrganizationSettingsCard
            context={context}
            description="Team credentials are used only when a member has not configured a personal key."
            detail="Personal credentials always win. Shared credentials are encrypted before storage and used as the next hierarchy tier."
            title="Fallback credential pool"
          />
          <SettingsCard title="OpenAI">
            <WorkspaceCredentialForm
              currentLastFour={credentials[0]?.lastFour}
              provider="openai"
              workspaceId={context.workspace.id}
            />
          </SettingsCard>
          <SettingsCard title="Anthropic">
            <WorkspaceCredentialForm
              currentLastFour={credentials[1]?.lastFour}
              provider="anthropic"
              workspaceId={context.workspace.id}
            />
          </SettingsCard>
          <OAuthConnectionsCard
            connected={{
              claude: credentials[4]?.credentialType === "OAUTH_TOKEN",
              codex: credentials[3]?.credentialType === "OAUTH_TOKEN",
            }}
            configured={{
              claude: getOAuthConfigurationStatus("claude").configured,
              codex: getOAuthConfigurationStatus("codex").configured,
            }}
            notice={parseOAuthNotice(params)}
            returnTo="/settings/org/agents"
            scopeType="WORKSPACE"
            workspaceId={context.workspace.id}
          />
          <SettingsCard title="Amazon Bedrock">
            <BedrockRoleForm
              currentRole={credentials[2]?.awsRoleArn}
              workspaceId={context.workspace.id}
            />
          </SettingsCard>
        </>
      ) : null}
    </OrganizationSettingsPage>
  );
}
