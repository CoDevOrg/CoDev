import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TheiaWorkspaceIde } from "@/components/theia-workspace-ide";
import { requireUser } from "@/lib/session";
import { getWorkspaceForMember } from "@/lib/workspaces";
import { requireWorkspacePermission } from "@/lib/access";

export const metadata: Metadata = { title: "IDE" };

export default async function WorkspaceIdePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspacePermission(workspaceId, user.id, "view");
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) notFound();

  return (
    <TheiaWorkspaceIde
      workspaceId={workspaceId}
      canEdit={
        workspace.accessRole === "owner" || workspace.accessRole === "co_steer"
      }
    />
  );
}
