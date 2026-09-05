import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkspaceActivityFeed } from "@/components/workspace-activity-feed";
import { getWorkspaceAccess } from "@/lib/access";
import { loadActivityAuditSnapshot } from "@/lib/activity-audit-server";
import { requireUser } from "@/lib/session";
import { getWorkspaceForMember } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Workspace activity" };

const PAGE_SIZE = 30;

export default async function WorkspaceActivityPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const [workspace, access, snapshot] = await Promise.all([
    getWorkspaceForMember(workspaceId, user.id),
    getWorkspaceAccess(workspaceId, user.id),
    loadActivityAuditSnapshot(workspaceId, user, { limit: PAGE_SIZE }),
  ]);
  if (!workspace || !access) {
    notFound();
  }

  return (
    <WorkspaceActivityFeed
      canRestoreFiles={access.permissions.edit}
      canRestoreWorkspace={access.permissions.merge}
      initialSnapshot={snapshot}
      repository={workspace.repository}
      workspaceId={workspaceId}
    />
  );
}
