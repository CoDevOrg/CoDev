import type { Metadata } from "next";

import { Gen2WorkspaceDashboard } from "@/components/gen2/workspace-dashboard";
import { AppChrome } from "@/components/shell/app-chrome";
import { requireUser } from "@/lib/auth/session";
import { getBillingStatus } from "@/lib/billing/access";
import { getOwnerComputeSummary } from "@/lib/gen2/compute-summary";
import { listGen2WorkspacesForUser } from "@/lib/gen2/workspaces";
import { resolveGithubConnection } from "@/lib/github/github";
import { connectGitHubAccount } from "@/app/actions/github";

export const metadata: Metadata = { title: "Workspace home" };

export default async function Gen2WorkspacesPage() {
  const user = await requireUser("/gen2");
  const [workspaces, github, billing, computeSummary] = await Promise.all([
    listGen2WorkspacesForUser(user.id),
    resolveGithubConnection(user.id),
    getBillingStatus(user.id),
    getOwnerComputeSummary(user.id),
  ]);

  return (
    <AppChrome user={user} sidebar>
      <main className="gen2-shell">
        <Gen2WorkspaceDashboard
          user={user}
          github={github}
          initialWorkspaces={workspaces}
          initialComputeSummary={computeSummary}
          appSlug={process.env.GITHUB_APP_SLUG}
          connectGitHub={connectGitHubAccount.bind(null, "/gen2")}
          billing={{
            hasAccess: billing.hasAccess,
            pastDue: billing.status === "past_due",
            priceUsdPerMonth: billing.priceUsdPerMonth,
          }}
        />
      </main>
    </AppChrome>
  );
}
