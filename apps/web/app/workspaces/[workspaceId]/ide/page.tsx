import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkspaceIdeLoader } from "@/components/workspace-ide-loader";
import { requireUser } from "@/lib/session";
import {
  getWorkspaceForMember,
  getWorkspaceRuntime,
  listWorkspaceMembers,
} from "@/lib/workspaces";
import { listAgentSessions } from "@/lib/agent-runtime";
import { requireWorkspacePermission } from "@/lib/access";
import { readWorkspaceStateEvents } from "@/lib/workspace-state";

export const metadata: Metadata = { title: "IDE" };

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
  return (
    <WorkspaceIdeLoader
      workspaceId={workspaceId}
      repository={workspace.repository}
      branch={workspace.defaultBranch}
      workspaceName={workspace.repository || "Untitled workspace"}
      members={members}
      initialAgentSessions={sessions}
      initialStateEvents={stateEvents}
      runtimeStatus={runtime?.status ?? "stopped"}
      canResume={workspace.accessRole !== "viewer"}
      canEdit={
        workspace.accessRole === "owner" || workspace.accessRole === "co_steer"
      }
      canTerminal={workspace.canTerminal}
      canMerge={workspace.canMerge}
      canReview={workspace.accessRole !== "viewer"}
      isOwner={workspace.role === "owner"}
      integrationHeadSha={workspace.integrationHeadSha}
      user={{
        id: user.id,
        name: user.name ?? null,
        login: user.githubLogin ?? user.name ?? "GitHub user",
        image: user.image ?? null,
      }}
    />
  );
}
