import type { Metadata } from "next";

import { CreateGen2WorkspaceForm } from "@/components/gen2/create-workspace-form";
import { Gen2WorkspaceList } from "@/components/gen2/workspace-list";
import { AppChrome } from "@/components/shell/app-chrome";
import { requireUser } from "@/lib/auth/session";
import { listGen2WorkspacesForUser } from "@/lib/gen2/workspaces";
import { resolveGithubConnection } from "@/lib/github/github";
import { connectGitHubAccount } from "@/app/actions/github";

export const metadata: Metadata = { title: "Gen 2 workspaces" };

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
          ownedWorkspaceCount={
            workspaces.filter((workspace) => workspace.role === "owner").length
          }
          appSlug={process.env.GITHUB_APP_SLUG}
          connectGitHub={connectGitHubAccount.bind(null, "/gen2")}
        />
        <Gen2WorkspaceList workspaces={workspaces} />
      </main>
    </AppChrome>
  );
}
