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
            <p className="eyebrow">Home</p>
            <h1>Workspaces</h1>
            <p>Create a blank space or start from a GitHub repository.</p>
          </div>
        </header>

        <section className="workspace-list">
          <div className="section-heading">
            <div>
              <h2>Your spaces</h2>
            </div>
            <span>
              {workspaces.length} {workspaces.length === 1 ? "space" : "spaces"}
            </span>
          </div>
          <div className="workspace-cards">
            <RepositoryPicker appSlug={process.env.GITHUB_APP_SLUG} />
            {workspaces.map((workspace) => (
              <Link
                className="workspace-card"
                href={`/workspaces/${workspace.id}`}
                key={workspace.id}
              >
                <span className="workspace-card-icon" aria-hidden="true" />
                <div>
                  <strong>
                    {workspace.repository
                      ? `${workspace.repositoryVisibility === "private" ? "🔒 " : ""}${workspace.repository}`
                      : "Untitled workspace"}
                  </strong>
                  <span>
                    {workspace.repository
                      ? `${workspace.defaultBranch} · ${workspace.baseSha.slice(0, 7)}`
                      : "No repository connected yet"}
                  </span>
                </div>
                <div className="workspace-card-meta">
                  <span className="status-pill">{workspace.status}</span>
                  <small>{workspace.role}</small>
                </div>
              </Link>
            ))}
          </div>
          {!workspaces.length ? (
            <p className="workspace-list-hint">
              Create your first one to get started.
            </p>
          ) : null}
        </section>
      </main>
    </AppChrome>
  );
}
