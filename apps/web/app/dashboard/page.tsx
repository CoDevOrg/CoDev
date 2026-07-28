import type { Metadata } from "next";
import Link from "next/link";

import { AppChrome } from "@/components/app-chrome";
import { RepositoryPicker } from "@/components/repository-picker";
import { getOpenAICredentialStatus } from "@/lib/credentials";
import { requireUser } from "@/lib/session";
import { listWorkspacesForUser } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Workspaces" };

export default async function DashboardPage() {
  const user = await requireUser();
  const [workspaces, credential] = await Promise.all([
    listWorkspacesForUser(user.id),
    getOpenAICredentialStatus(user.id),
  ]);

  return (
    <AppChrome user={user}>
      <main className="dashboard-shell">
        <header className="dashboard-heading">
          <div>
            <p className="eyebrow">Workspace control</p>
            <h1>Build together, from the browser.</h1>
            <p>
              Open a GitHub repository, invite collaborators, and decide who can
              use terminal and merge controls.
            </p>
          </div>
          <div className="credential-chip">
            <span className={credential ? "dot-ready" : "dot-muted"} />
            OpenAI key {credential ? `••••${credential.lastFour}` : "not added"}
            <Link href="/settings">Manage</Link>
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
                    <strong>{workspace.repository}</strong>
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
              <p>Choose a public repository above to create the first one.</p>
            </div>
          )}
        </section>
      </main>
    </AppChrome>
  );
}
