import type { Metadata } from "next";

import "@/app/product-theme.css";

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
      <main className="product-scope min-h-dvh px-6 py-12 sm:px-12">
        <div className="mx-auto flex max-w-[960px] flex-col gap-8">
          <header className="space-y-2">
            <span className="inline-block text-[11px] font-bold tracking-[0.12em] text-primary uppercase">
              Gen 2
            </span>
            <h1 className="m-0 text-3xl leading-tight font-semibold tracking-tight">
              Cloud workspaces
            </h1>
            <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              A workspace is a cloud computer you and your teammates share, with
              an AI agent built in. Open one and it starts on its own; send the
              link and anyone you invite works on that same computer.
            </p>
          </header>
          <CreateGen2WorkspaceForm
            githubConnected={github.connected}
            ownedWorkspaceCount={
              workspaces.filter((workspace) => workspace.role === "owner")
                .length
            }
            appSlug={process.env.GITHUB_APP_SLUG}
            connectGitHub={connectGitHubAccount.bind(null, "/gen2")}
          />
          <Gen2WorkspaceList workspaces={workspaces} />
        </div>
      </main>
    </AppChrome>
  );
}
