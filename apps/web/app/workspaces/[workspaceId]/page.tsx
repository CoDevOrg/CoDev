import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import { WorkspaceAccess } from "@/components/workspace-access";
import { WorkspaceRuntime } from "@/components/workspace-runtime";
import { requireUser } from "@/lib/session";
import {
  getWorkspaceForMember,
  getWorkspaceRuntime,
  listWorkspaceMembers,
} from "@/lib/workspaces";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) notFound();

  const [members, runtime] = await Promise.all([
    listWorkspaceMembers(workspaceId),
    getWorkspaceRuntime(workspaceId),
  ]);

  return (
    <AppChrome user={user}>
      <main className="workspace-overview">
        <Link className="back-link" href="/dashboard">
          ← All workspaces
        </Link>
        <header className="workspace-overview-head">
          <div className="repo-icon large" aria-hidden="true">
            ⑂
          </div>
          <div>
            <p className="eyebrow">GitHub workspace</p>
            <h1>
              {workspace.repositoryVisibility === "private" ? "🔒 " : ""}
              {workspace.repository}
            </h1>
            <p>
              {workspace.defaultBranch} at{" "}
              <code>{workspace.baseSha.slice(0, 12)}</code>
            </p>
          </div>
          <span className="status-pill">{workspace.status}</span>
        </header>

        <WorkspaceRuntime
          workspaceId={workspaceId}
          runtime={
            runtime
              ? {
                  status: runtime.status,
                  sandboxId: runtime.sandboxId,
                  lastError: runtime.lastError,
                }
              : null
          }
          isOwner={workspace.role === "owner"}
        />

        <div className="workspace-stats">
          <div>
            <span>Members</span>
            <strong>{members.length}</strong>
          </div>
          <div>
            <span>Your role</span>
            <strong>{workspace.role}</strong>
          </div>
          <div>
            <span>Terminal</span>
            <strong>{workspace.canTerminal ? "Allowed" : "Not allowed"}</strong>
          </div>
          <div>
            <span>Merge</span>
            <strong>{workspace.canMerge ? "Allowed" : "Not allowed"}</strong>
          </div>
        </div>

        <WorkspaceAccess
          workspaceId={workspaceId}
          members={members}
          isOwner={workspace.role === "owner"}
        />
      </main>
    </AppChrome>
  );
}
