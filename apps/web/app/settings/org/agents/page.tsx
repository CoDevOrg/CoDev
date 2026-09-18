import { BedrockRoleForm } from "@/components/settings/bedrock-role-form";
import { ClaudeCliSubscriptionCard } from "@/components/settings/claude-cli-subscription-card";
import { CursorConnectCard } from "@/components/settings/cursor-connect-card";
import { HostedCodexSubscriptionCard } from "@/components/settings/hosted-codex-subscription-card";
import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
  SettingsCard,
} from "@/components/settings/settings-content";
import { WorkspaceCredentialForm } from "@/components/settings/workspace-credential-form";
import {
  getClaudeCliTokenPublicStatus,
  getProviderCredentialStatus,
} from "@/lib/providers/credentials";
import { getHostedCodexPublicStatus } from "@/lib/providers/hosted-codex-subscription-credentials";
import { getActiveOrganizationSettingsContext } from "@/lib/admin/organization-settings";
import { requireUser } from "@/lib/auth/session";
import { parseHostedCodexNotice } from "@/lib/admin/settings-notices";

export default async function OrganizationAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    hostedCodex?: string;
  }>;
}) {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);
  const params = await searchParams;
  const [openai, anthropic, bedrock, cursor, claudeCliToken, hostedCodex] =
    context
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
          // A shared Claude login is stored ORGANIZATION-scoped (its scope id
          // is this workspace's id), not WORKSPACE — a separate scope used
          // for the plain fallback keys above.
          getClaudeCliTokenPublicStatus({
            scopeType: "ORGANIZATION",
            scopeId: context.workspace.id,
            canManage: context.canWrite,
          }),
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
          <SettingsCard
            description="Sign in through Cursor, or paste a personal API key as a fallback."
            title="Cursor"
          >
            <CursorConnectCard
              connected={cursor?.credentialType === "OAUTH_TOKEN"}
              returnTo="/settings/org/agents"
              scopeType="WORKSPACE"
              workspaceId={context.workspace.id}
            />
            <WorkspaceCredentialForm
              currentLastFour={cursor?.lastFour}
              provider="cursor"
              workspaceId={context.workspace.id}
            />
          </SettingsCard>
          {claudeCliToken ? (
            <ClaudeCliSubscriptionCard
              organizationId={context.workspace.id}
              status={claudeCliToken}
            />
          ) : null}
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
