import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import { AgentPanel } from "@/components/agent-panel";
import { ShareDialog } from "@/components/share-dialog";
import { WorkspaceRuntime } from "@/components/workspace-runtime";
import { requireUser } from "@/lib/session";
import { requireWorkspacePermission } from "@/lib/access";
import {
  getWorkspaceForMember,
  getWorkspaceRuntime,
  listWorkspaceMembers,
} from "@/lib/workspaces";
import { listAgentSessions } from "@/lib/agent-runtime";
import { readWorkspaceStateEvents } from "@/lib/workspace-state";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspacePermission(workspaceId, user.id, "view");
  const workspace = await getWorkspaceForMember(workspaceId, user.id);
  if (!workspace) notFound();

  const [members, runtime, sessions, stateEvents] = await Promise.all([
    listWorkspaceMembers(workspaceId),
    getWorkspaceRuntime(workspaceId),
    listAgentSessions(workspaceId),
    readWorkspaceStateEvents(workspaceId),
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
          canProvision={
            workspace.accessRole === "owner" ||
            workspace.accessRole === "co_steer"
          }
          canResume={workspace.accessRole !== "viewer"}
          defaultBranch={workspace.defaultBranch}
        />

        <section
          className="workspace-state-preview"
          aria-label="Workspace conversation"
        >
          <div className="workspace-state-preview-heading">
            <p className="eyebrow">Durable workspace state</p>
            <h2>Conversation and agent history</h2>
            <p>
              This timeline is loaded from PostgreSQL before the compute sandbox
              resumes.
            </p>
          </div>
          <AgentPanel
            workspaceId={workspaceId}
            canMerge={workspace.canMerge}
            canReview={workspace.accessRole !== "viewer"}
            canSteer={
              (workspace.accessRole === "owner" ||
                workspace.accessRole === "co_steer") &&
              runtime?.status === "ready"
            }
            initialSessions={sessions}
            initialStateEvents={stateEvents}
          />
        </section>

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

        <ShareDialog
          workspaceId={workspaceId}
          workspaceName={workspace.repository}
          members={members}
          isOwner={workspace.role === "owner"}
        />
      </main>
    </AppChrome>
  );
}
