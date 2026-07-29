import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { WorkspaceIde } from "@/components/workspace-ide";
import { requireUser } from "@/lib/session";
import {
  getWorkspaceForMember,
  getWorkspaceRuntime,
} from "@/lib/workspaces";

export const metadata: Metadata = { title: "IDE" };

export default async function WorkspaceIdePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const [workspace, runtime] = await Promise.all([
    getWorkspaceForMember(workspaceId, user.id),
    getWorkspaceRuntime(workspaceId),
  ]);
  if (!workspace) notFound();
  if (runtime?.status !== "ready") redirect(`/workspaces/${workspaceId}`);

  return (
    <WorkspaceIde
      workspaceId={workspaceId}
      repository={workspace.repository}
      branch={workspace.defaultBranch}
      canTerminal={workspace.canTerminal}
      user={{
        name: user.name ?? null,
        login: user.githubLogin ?? user.name ?? "GitHub user",
        image: user.image ?? null,
      }}
    />
  );
}
