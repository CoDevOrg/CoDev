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
  OrganizationSettingsCard,
  OrganizationSettingsPage,
  SettingsCard,
} from "@/components/settings/settings-content";
import { WorkspaceCredentialForm } from "@/components/workspace-credential-form";
import {
  getOAuthCredentialStatus,
  getProviderCredentialStatus,
} from "@/lib/credentials";
import { getHostedCodexPublicStatus } from "@/lib/hosted-codex-subscription-credentials";
import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { getOAuthConfigurationStatus } from "@/lib/oauth";
import { requireUser } from "@/lib/session";

export default async function OrganizationAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    oauth?: string;
    status?: string;
    hostedCodex?: string;
  }>;
}) {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);
  const params = await searchParams;
  const [openai, anthropic, bedrock, cursor, claude, hostedCodex] = context
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
        getProviderCredentialStatus(
          "WORKSPACE",
          context.workspace.id,
          "cursor",
        ),
        getOAuthCredentialStatus(
          "WORKSPACE",
          context.workspace.id,
          "anthropic",
        ),
        getHostedCodexPublicStatus({
          scopeType: "ORGANIZATION",
          scopeId: context.workspace.id,
          canManage: context.canWrite,
        }),
      ])
    : [null, null, null, null, null, null];

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
              currentLastFour={openai?.lastFour}
              provider="openai"
              workspaceId={context.workspace.id}
            />
          </SettingsCard>
          <SettingsCard title="Anthropic">
            <WorkspaceCredentialForm
              currentLastFour={anthropic?.lastFour}
              provider="anthropic"
              workspaceId={context.workspace.id}
            />
          </SettingsCard>
          <SettingsCard title="Cursor">
            <WorkspaceCredentialForm
              currentLastFour={cursor?.lastFour}
              provider="cursor"
              workspaceId={context.workspace.id}
            />
          </SettingsCard>
          <OAuthConnectionsCard
            connected={{
              claude: claude?.credentialType === "OAUTH_TOKEN",
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
            returnTo="/settings/org/agents"
            scopeType="WORKSPACE"
            workspaceId={context.workspace.id}
          />
          {hostedCodex ? (
            <HostedCodexSubscriptionCard
              notice={parseHostedCodexNotice(params)}
              organizationId={context.workspace.id}
              returnTo="/settings/org/agents"
              status={hostedCodex}
            />
          ) : null}
          <SettingsCard title="Amazon Bedrock">
            <BedrockRoleForm
              currentRole={bedrock?.awsRoleArn}
              workspaceId={context.workspace.id}
            />
          </SettingsCard>
        </>
      ) : null}
    </OrganizationSettingsPage>
  );
}
