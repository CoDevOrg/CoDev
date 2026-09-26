import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { SupersetFilePane } from "@/components/gen2/superset-file-pane";
import { requireUser } from "@/lib/auth/session";
import { Gen2AccessError } from "@/lib/gen2/errors";
import { isGen2SupersetFilePaneEnabled } from "@/lib/gen2/superset-file-feature";
import { getGen2WorkspaceDetail } from "@/lib/gen2/workspaces";

export const metadata: Metadata = { title: "Superset files" };

export default async function Gen2SupersetFilesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  if (!isGen2SupersetFilePaneEnabled()) notFound();

  const { workspaceId } = await params;
  const user = await requireUser(`/gen2/${workspaceId}/superset`);
  let role: "owner" | "editor" | "viewer";
  try {
    const workspace = await getGen2WorkspaceDetail(workspaceId, user.id);
    role = workspace.role;
  } catch (error) {
    if (error instanceof Gen2AccessError) notFound();
    throw error;
  }

  return (
    <SupersetFilePane workspaceId={workspaceId} canEdit={role !== "viewer"} />
  );
}
