import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkspaceHome } from "@/components/workspace-home";
import { permissionsForRole } from "@/lib/access";
import { hasLinkedCursorCredential } from "@/lib/credentials";
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
  const [workspace, providerSnapshot, cursorAvailable] = await Promise.all([
    getWorkspaceForMember(workspaceId, user.id),
    loadProviderConnectionSnapshot(user),
    hasLinkedCursorCredential(user.id, workspaceId),
  ]);
  if (!workspace) {
    notFound();
  }

  // What the workspace chat tab can actually *run*, not merely what the member
  // has connected. The shared IDE host materializes a Codex subscription as a
  // CODEX_HOME on the box, so a Codex CLI login works there — but there is no
  // equivalent for a Claude subscription: `resolveClaudeEnvForIde` forwards an
  // Anthropic API key only, and a subscription is deliberately kept off the
  // shared session (it runs through isolated managed agents instead). So
  // advertising Claude on a subscription alone lands the member on a `claude`
  // process that boots straight to "Not logged in". Anthropic therefore requires
  // an API-key connection here; only OpenAI counts its CLI subscription.
  const availableProviders = (["openai", "anthropic"] as const).filter(
    (provider) => {
      const keyConnected = providerSnapshot.connections.some(
        (connection) =>
          connection.provider === provider && connection.status === "connected",
      );
      if (provider === "anthropic") {
        return keyConnected;
      }
      const cliConnected = providerSnapshot.cliSubscriptions.some(
        (subscription) =>
          subscription.provider === "codex" &&
          subscription.status === "connected",
      );
      return cliConnected || keyConnected;
    },
  );

  return (
    <WorkspaceHome
      availableProviders={availableProviders}
      canInvite={permissionsForRole(workspace.accessRole).invite}
      cursorAvailable={cursorAvailable}
      repository={workspace.repository}
      workspaceId={workspace.id}
    />
  );
}
