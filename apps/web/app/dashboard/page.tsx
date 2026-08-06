import type { Metadata } from "next";

import { AppChrome } from "@/components/app-chrome";
import { WorkspaceGrid } from "@/components/workspace-grid";
import { requireUser } from "@/lib/session";
import { listWorkspacesForUser } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Workspaces" };

export default async function DashboardPage() {
  const user = await requireUser();
  const workspaces = await listWorkspacesForUser(user.id);

  return (
    <AppChrome user={user}>
      <main className="dashboard-shell">
        <WorkspaceGrid
          appSlug={process.env.GITHUB_APP_SLUG}
          user={user}
          workspaces={workspaces.map((workspace) => ({
            ...workspace,
            updatedAt: workspace.updatedAt.toISOString(),
          }))}
        />
      </main>
    </AppChrome>
  );
}
