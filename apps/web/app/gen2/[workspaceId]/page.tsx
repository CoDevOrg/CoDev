import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Gen2WorkspaceRoom } from "@/components/gen2/workspace-room";
import { AppChrome } from "@/components/shell/app-chrome";
import { requireUser } from "@/lib/auth/session";
import { Gen2AccessError } from "@/lib/gen2/errors";
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
    throw error;
  }

  return (
    <AppChrome user={user} sidebar>
      <main className="gen2-shell">
        <Link className="gen2-back" href="/gen2">
          All workspaces
        </Link>
        <Gen2WorkspaceRoom workspace={workspace} />
      </main>
    </AppChrome>
  );
}
