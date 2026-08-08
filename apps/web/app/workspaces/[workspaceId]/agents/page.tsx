import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentPanel } from "@/components/agent-panel";
import { requireWorkspacePermission } from "@/lib/access";
import { listAgentSessions } from "@/lib/agent-runtime";
import { requireUser } from "@/lib/session";
import { getWorkspaceForMember } from "@/lib/workspaces";
import { readWorkspaceStateEvents } from "@/lib/workspace-state";

export const metadata: Metadata = {
  title: "Agents",
  robots: { index: false, follow: false },
};

export default async function WorkspaceAgentsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspacePermission(workspaceId, user.id, "view");

  const [workspace, sessions, stateEvents] = await Promise.all([
    getWorkspaceForMember(workspaceId, user.id),
    listAgentSessions(workspaceId),
    readWorkspaceStateEvents(workspaceId),
  ]);
  if (!workspace) notFound();

  const canSteer =
    workspace.accessRole === "owner" || workspace.accessRole === "co_steer";

  return (
    <main className="live-ide orca-agent-embed" aria-label="CoDev agents">
      <div
        id="topbar-review-actions"
        className="topbar-review-actions"
        aria-label="Agent review actions"
      />
      <div className="orca-agent-embed-body">
        <AgentPanel
          workspaceId={workspaceId}
          canMerge={workspace.canMerge}
          canReview={workspace.accessRole !== "viewer"}
          canSteer={canSteer && Boolean(workspace.repository)}
          initialSessions={sessions}
          initialStateEvents={stateEvents}
        />
      </div>
    </main>
  );
}
