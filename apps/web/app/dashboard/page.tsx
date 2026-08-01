import type { Metadata } from "next";
import Link from "next/link";

import { AppChrome } from "@/components/app-chrome";
import { RepositoryPicker } from "@/components/repository-picker";
import { requireUser } from "@/lib/session";
import { listWorkspacesForUser } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Workspaces" };

export default async function DashboardPage() {
  const user = await requireUser();
  const workspaces = await listWorkspacesForUser(user.id);

  return (
    <AppChrome user={user}>
      <main className="dashboard-shell">
        <header className="dashboard-heading">
          <div>
            <p className="eyebrow">Your workspace</p>
            <h1>Create a workspace.</h1>
            <p>
              Choose a GitHub repository to start building. You can invite
              collaborators and review work together in the browser.
            </p>
          </div>
        </header>

        <RepositoryPicker appSlug={process.env.GITHUB_APP_SLUG} />

        <section className="workspace-list">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your access</p>
              <h2>Workspaces</h2>
            </div>
            <span>{workspaces.length} total</span>
          </div>
          {workspaces.length ? (
            <div className="workspace-cards">
              {workspaces.map((workspace) => (
                <Link
                  className="workspace-card"
                  href={`/workspaces/${workspace.id}`}
                  key={workspace.id}
                >
                  <div className="repo-icon" aria-hidden="true">
                    ⑂
                  </div>
                  <div>
                    <strong>
                      {workspace.repositoryVisibility === "private"
                        ? "🔒 "
                        : ""}
                      {workspace.repository}
                    </strong>
                    <span>
                      {workspace.defaultBranch} ·{" "}
                      {workspace.baseSha.slice(0, 7)}
                    </span>
                  </div>
                  <div className="workspace-card-meta">
                    <span className="status-pill">{workspace.status}</span>
                    <small>{workspace.role}</small>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-card">
              <span aria-hidden="true">＋</span>
              <strong>No workspaces yet</strong>
              <p>Choose a repository above to create the first one.</p>
            </div>
          )}
        </section>
      </main>
    </AppChrome>
  );
}
