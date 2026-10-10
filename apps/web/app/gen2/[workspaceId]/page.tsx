import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { SupersetWorkspaceShell } from "@/components/gen2/superset-workspace-shell";
import { WorkspaceRealtimeProvider } from "@/components/gen2/workspace-realtime-provider";
import { Toaster } from "@/components/ui/sonner";
import { readWorkspaceView } from "@/components/gen2/workspace-view-url";
import { requireUser } from "@/lib/auth/session";
import { Gen2AccessError, Gen2LifecycleError } from "@/lib/gen2/errors";
import { isGen2PreviewEnabled } from "@/lib/gen2/preview-config";
import { isGen2SupersetRuntimeEnabled } from "@/lib/gen2/superset-runtime-feature";
import { getGen2WorkspaceDetail } from "@/lib/gen2/workspaces";

export const metadata: Metadata = { title: "Workspace" };

export default async function Gen2WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
    <WorkspaceRealtimeProvider
      workspaceId={workspaceId}
      currentUserId={user.id}
      initialMembers={workspace.members}
    >
      <SupersetWorkspaceShell
        workspace={workspace}
        workspaceId={workspaceId}
        currentUserId={user.id}
        canEdit={workspace.role !== "viewer"}
        runtimeEnabled={isGen2SupersetRuntimeEnabled()}
        previewEnabled={isGen2PreviewEnabled()}
        initialView={readWorkspaceView(await searchParams)}
      />
      <Toaster
        position="bottom-right"
        toastOptions={{ className: "gen2-workspace-surface gen2-toast" }}
      />
    </WorkspaceRealtimeProvider>
  );
}
