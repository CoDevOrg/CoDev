import type { Metadata } from "next";

import { Gen2WorkspaceDashboard } from "@/components/gen2/workspace-dashboard";
import { AppChrome } from "@/components/shell/app-chrome";
import { requireUser } from "@/lib/auth/session";
import { getBillingStatus } from "@/lib/billing/access";
import { getGen2HomeSnapshot } from "@/lib/gen2/home-snapshot";
import { resolveGithubConnection } from "@/lib/github/github";
import { connectGitHubAccount } from "@/app/actions/github";

export const metadata: Metadata = { title: "Workspace home" };

export default async function Gen2WorkspacesPage() {
  const user = await requireUser("/gen2");
  const [snapshot, github, billing] = await Promise.all([
    getGen2HomeSnapshot(user.id),
    resolveGithubConnection(user.id),
    getBillingStatus(user.id),
  ]);

  return (
    <AppChrome user={user} sidebar>
      <main className="gen2-shell">
        <Gen2WorkspaceDashboard
          user={{ name: user.name ?? null }}
          github={github}
          initialSnapshot={snapshot}
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
