import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkspaceHome } from "@/components/workspace-home";
import { permissionsForRole } from "@/lib/access";
import { loadProviderConnectionSnapshot } from "@/lib/provider-connection-server";
import { requireUser } from "@/lib/session";
import { getWorkspaceForMember } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const [workspace, providerSnapshot] = await Promise.all([
    getWorkspaceForMember(workspaceId, user.id),
    loadProviderConnectionSnapshot(user),
  ]);
  if (!workspace) {
    notFound();
  }

  const availableProviders = (["openai", "anthropic"] as const).filter(
    (provider) => {
      const cli = provider === "openai" ? "codex" : "claude";
      const cliConnected = providerSnapshot.cliSubscriptions.some(
        (subscription) =>
          subscription.provider === cli && subscription.status === "connected",
      );
      const keyConnected = providerSnapshot.connections.some(
        (connection) =>
          connection.provider === provider && connection.status === "connected",
      );
      return cliConnected || keyConnected;
    },
  );

  return (
    <WorkspaceHome
      availableProviders={availableProviders}
      canCreateChannel={permissionsForRole(workspace.accessRole).edit}
      canInvite={permissionsForRole(workspace.accessRole).invite}
      hasRepository={Boolean(
        workspace.repository && workspace.githubRepositoryId,
      )}
      repository={workspace.repository}
      workspaceId={workspace.id}
    />
  );
}
