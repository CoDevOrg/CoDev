import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkspaceHome } from "@/components/workspace-home";
import { permissionsForRole } from "@/lib/access";
import { hasLinkedCursorCredential } from "@/lib/credentials";
import { getWorkspaceCreditStatus } from "@/lib/compute-credits";
import { isUserAdmin } from "@/lib/admin";
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
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams?: Promise<{
    branch?: string | string[];
    agent?: string | string[];
  }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const routeParams = searchParams ? await searchParams : {};
  const requestedBranch = Array.isArray(routeParams.branch)
    ? routeParams.branch[0]
    : routeParams.branch;
  const hasBranchControlCharacter = requestedBranch
    ? Array.from(requestedBranch).some((character) => {
        const code = character.charCodeAt(0);
        return code < 0x20 || code === 0x7f;
      })
    : false;
  const initialBranch =
    requestedBranch &&
    requestedBranch.length <= 255 &&
    !hasBranchControlCharacter
      ? requestedBranch.trim() || undefined
      : undefined;
  const requestedAgent = Array.isArray(routeParams.agent)
    ? routeParams.agent[0]
    : routeParams.agent;
  const hasAgentControlCharacter = requestedAgent
    ? Array.from(requestedAgent).some((character) => {
        const code = character.charCodeAt(0);
        return code < 0x20 || code === 0x7f;
      })
    : false;
  const initialAgent =
    requestedAgent && requestedAgent.length <= 255 && !hasAgentControlCharacter
      ? requestedAgent.trim() || undefined
      : undefined;
  const [workspace, providerSnapshot, cursorAvailable] = await Promise.all([
    getWorkspaceForMember(workspaceId, user.id),
    loadProviderConnectionSnapshot(user, workspaceId),
    hasLinkedCursorCredential(user.id, workspaceId),
  ]);
  if (!workspace) {
    notFound();
  }
  const isAdmin = await isUserAdmin(user.id);
  const creditStatus = isAdmin
    ? null
    : await getWorkspaceCreditStatus(workspaceId);

  // What the workspace chat tab can actually *run*, not merely what the member
  // has connected: a workspace-enabled API key or supported subscription.
  // Codex browser OAuth and local-CLI login both provide the same auth cache;
  // browser-only Claude and Cursor runtimes remain unavailable here.
  const availableProviders = workspaceReadyProviders(providerSnapshot).filter(
    (provider): provider is "openai" | "anthropic" => provider !== "cursor",
  );

  return (
    <WorkspaceHome
      availableProviders={availableProviders}
      providerPreflight={workspaceProviderPreflight(providerSnapshot)}
      canInvite={permissionsForRole(workspace.accessRole).invite}
      cursorAvailable={cursorAvailable}
      creditStatus={creditStatus}
      isAdmin={isAdmin}
      repository={workspace.repository}
      workspaceId={workspace.id}
      {...(initialBranch ? { initialBranch } : {})}
      {...(initialAgent ? { initialAgent } : {})}
    />
  );
}
