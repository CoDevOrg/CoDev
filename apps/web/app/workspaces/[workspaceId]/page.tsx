import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireWorkspacePermission } from "@/lib/access";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Workspace" };

/**
 * Keep existing workspace URLs valid without making users pass through a
 * status-only overview before they can start working.
 */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspacePermission(workspaceId, user.id, "view");
  redirect(`/workspaces/${workspaceId}/ide`);
}
