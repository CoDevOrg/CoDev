import Link from "next/link";

import { BedrockRoleForm } from "@/components/bedrock-role-form";
import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
  SettingsCard,
} from "@/components/settings/settings-content";
import { WorkspaceCredentialForm } from "@/components/workspace-credential-form";
import { getProviderCredentialStatus } from "@/lib/credentials";
import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { requireUser } from "@/lib/session";

export default async function OrganizationAgentsPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);
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
      ])
    : [null, null, null];

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
          <SettingsCard title="OAuth connections">
            <div className="form-actions">
              <Link
                className="primary-button"
                href={`/api/auth/oauth/claude?scopeType=WORKSPACE&workspaceId=${context.workspace.id}&returnTo=/settings/org/agents`}
              >
                Connect Claude Code
              </Link>
              <Link
                className="primary-button"
                href={`/api/auth/oauth/codex?scopeType=WORKSPACE&workspaceId=${context.workspace.id}&returnTo=/settings/org/agents`}
              >
                Connect Codex
              </Link>
            </div>
          </SettingsCard>
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
