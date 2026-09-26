import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Gen2WorkspaceRoom } from "@/components/gen2/workspace-room";
import { AppChrome } from "@/components/shell/app-chrome";
import { requireUser } from "@/lib/auth/session";
import { Gen2AccessError, Gen2LifecycleError } from "@/lib/gen2/errors";
import { getGen2WorkspaceDetail } from "@/lib/gen2/workspaces";

export const metadata: Metadata = { title: "Workspace" };

export default async function Gen2WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await requireUser(`/gen2/${workspaceId}`);
  let workspace;
  try {
    workspace = await getGen2WorkspaceDetail(workspaceId, user.id);
  } catch (error) {
    if (error instanceof Gen2AccessError) notFound();
    if (error instanceof Gen2LifecycleError && error.status === 409) {
      redirect("/gen2");
    }
    throw error;
  }

  return (
    <AppChrome user={user} sidebar>
      <Gen2WorkspaceRoom workspace={workspace} />
    </AppChrome>
  );
}
