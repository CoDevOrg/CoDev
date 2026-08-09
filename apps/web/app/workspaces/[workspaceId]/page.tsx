import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrcaWorkspace } from "@/components/orca-workspace";
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
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) {
    notFound();
  }

  return (
    <OrcaWorkspace
      workspaceId={workspace.id}
      repository={workspace.repository}
    />
  );
}
