import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireWorkspacePermission } from "@/lib/access";
import { listAgentSessions } from "@/lib/agent-runtime";
import { clerkAuthConfigured } from "@/lib/identity";
import { requireUser } from "@/lib/session";
import { getVmMinutesUsed, VM_MINUTE_LIFETIME_QUOTA } from "@/lib/vm-usage";
import { readWorkspaceStateEvents } from "@/lib/workspace-state";
import {
  getWorkspaceForMember,
  getWorkspaceRuntime,
  listWorkspaceMembers,
} from "@/lib/workspaces";
import { OrcaWorkspaceIdeLoader } from "@/components/workspace-ide-loader";

export const metadata: Metadata = { title: "Orca IDE" };

export default async function WorkspaceIdePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspacePermission(workspaceId, user.id, "view");
  const [workspace, runtime, members, sessions, stateEvents] =
    await Promise.all([
      getWorkspaceForMember(workspaceId, user.id),
      getWorkspaceRuntime(workspaceId),
      listWorkspaceMembers(workspaceId),
      listAgentSessions(workspaceId),
      readWorkspaceStateEvents(workspaceId),
    ]);
  if (!workspace) notFound();
  const vmMinutesUsed = await getVmMinutesUsed(workspace.ownerId);

  return (
    <OrcaWorkspaceIdeLoader
      workspaceId={workspaceId}
      repository={workspace.repository}
      branch={workspace.defaultBranch}
      workspaceName={workspace.repository || "Untitled workspace"}
      members={members}
      initialAgentSessions={sessions}
      initialStateEvents={stateEvents}
      runtimeStatus={runtime?.status ?? "stopped"}
      runtimeError={runtime?.lastError ?? null}
      canStartRuntime={workspace.accessRole !== "viewer"}
      canEdit={
        workspace.accessRole === "owner" || workspace.accessRole === "co_steer"
      }
      canTerminal={workspace.canTerminal}
      canMerge={workspace.canMerge}
      canReview={workspace.accessRole !== "viewer"}
      canShare={
        workspace.accessRole === "owner" || workspace.accessRole === "co_steer"
      }
      isOwner={workspace.role === "owner"}
      integrationHeadSha={workspace.integrationHeadSha}
      vmMinutesUsed={vmMinutesUsed}
      vmMinutesQuota={VM_MINUTE_LIFETIME_QUOTA}
      useClerkAuth={clerkAuthConfigured()}
      user={{
        id: user.id,
        name: user.name ?? null,
        login: user.githubLogin ?? user.name ?? "GitHub user",
        image: user.image ?? null,
      }}
    />
  );
}
