import type { Metadata } from "next";
import Link from "next/link";

import { CreateGen2WorkspaceForm } from "@/components/gen2/create-workspace-form";
import { AppChrome } from "@/components/shell/app-chrome";
import { requireUser } from "@/lib/auth/session";
import { listGen2WorkspacesForUser } from "@/lib/gen2/workspaces";
import { resolveGithubConnection } from "@/lib/github/github";
import { connectGitHubAccount } from "@/app/actions/github";

export const metadata: Metadata = { title: "Gen 2 workspaces" };

// A workspace nobody has opened has no machine, which is the cheap and
// correct state -- not a failure to start. Opening one brings it up.
const STATUS_LABEL = {
  pending: "Idle",
  provisioning: "Starting",
  ready: "Ready",
  failed: "Failed",
  stopped: "Idle",
} as const;

export default async function Gen2WorkspacesPage() {
  const user = await requireUser("/gen2");
  const [workspaces, github] = await Promise.all([
    listGen2WorkspacesForUser(user.id),
    resolveGithubConnection(user.id),
  ]);

  return (
    <AppChrome user={user} sidebar>
      <main className="gen2-shell">
        <p className="eyebrow">Gen 2</p>
        <h1>Cloud workspaces</h1>
        <p className="gen2-lede">
          A workspace is a Firecracker instance you can share. Open one and its
          machine comes up; send the link and anyone you invite works on that
          same machine, alongside Codex.
        </p>
        <CreateGen2WorkspaceForm
          githubConnected={github.connected}
          appSlug={process.env.GITHUB_APP_SLUG}
          connectGitHub={connectGitHubAccount.bind(null, "/gen2")}
        />
        {workspaces.length === 0 ? (
          <p className="gen2-empty">No workspaces yet.</p>
        ) : (
          <ul className="gen2-list">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link className="gen2-card" href={`/gen2/${workspace.id}`}>
                  <strong>{workspace.name}</strong>
                  {workspace.repository ? (
                    <span className="gen2-card-repo">
                      {workspace.repository.fullName}
                    </span>
                  ) : null}
                  <span
                    className={`gen2-status gen2-status-${workspace.status}`}
                  >
                    <span className="gen2-status-dot" aria-hidden="true" />
                    {STATUS_LABEL[workspace.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppChrome>
  );
}
