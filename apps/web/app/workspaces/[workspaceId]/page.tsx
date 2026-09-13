import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkspaceHome } from "@/components/workspace-home";
import { permissionsForRole } from "@/lib/access";
import { hasLinkedCursorCredential } from "@/lib/credentials";
import { loadProviderConnectionSnapshot } from "@/lib/provider-connection-server";
import {
  workspaceProviderPreflight,
  workspaceReadyProviders,
} from "@/lib/provider-surface-capability";
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
  const [workspace, providerSnapshot, cursorAvailable] = await Promise.all([
    getWorkspaceForMember(workspaceId, user.id),
    loadProviderConnectionSnapshot(user),
    hasLinkedCursorCredential(user.id, workspaceId),
  ]);
  if (!workspace) {
    notFound();
  }

  // What the workspace chat tab can actually *run*, not merely what the member
  // has connected: a workspace-enabled API key or local-CLI login. A browser
  // subscription never reaches the shared host, so advertising it here would
  // land the member on a `claude`/`codex` process that boots "Not logged in".
  const availableProviders = workspaceReadyProviders(providerSnapshot).filter(
    (provider): provider is "openai" | "anthropic" => provider !== "cursor",
  );

  return (
    <WorkspaceHome
      availableProviders={availableProviders}
      providerPreflight={workspaceProviderPreflight(providerSnapshot)}
      canInvite={permissionsForRole(workspace.accessRole).invite}
      cursorAvailable={cursorAvailable}
      repository={workspace.repository}
      workspaceId={workspace.id}
    />
  );
}
