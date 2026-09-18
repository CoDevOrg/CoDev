import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkspaceActivityFeed } from "@/components/workspace/workspace-activity-feed";
import { loadActivityAuditSnapshot } from "@/lib/workspaces/activity-audit-server";
import { requireUser } from "@/lib/auth/session";
import { getWorkspaceForMember } from "@/lib/workspaces/workspaces";

export const metadata: Metadata = { title: "Workspace activity" };

const PAGE_SIZE = 30;

export default async function WorkspaceActivityPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const [workspace, snapshot] = await Promise.all([
    getWorkspaceForMember(workspaceId, user.id),
    loadActivityAuditSnapshot(workspaceId, user, { limit: PAGE_SIZE }),
  ]);
  if (!workspace) {
    notFound();
  }

  return (
    <WorkspaceActivityFeed
      initialSnapshot={snapshot}
      repository={workspace.repository}
      workspaceId={workspaceId}
    />
  );
}
