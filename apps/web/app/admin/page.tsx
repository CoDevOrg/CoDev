import type { Metadata } from "next";

import "@/app/product-theme.css";

import { AppChrome } from "@/components/shell/app-chrome";
import { AdminConsoleClient } from "@/components/admin/admin-console-client";
import { listAccessRequests } from "@/lib/admin/access-requests";
import { requireAdmin } from "@/lib/admin/admin";
import {
  getAdminSummary,
  getDailyTraffic,
  getRecentVisits,
  getTopPaths,
  getUserDirectory,
} from "@/lib/admin/admin-stats";
import { getAdminFeatureAccessData } from "@/lib/admin/admin-feature-access";
import { getAdminAccountAccessData } from "@/lib/admin/admin-account-access";

import { buildAdminPlanSummary } from "@/lib/admin/admin-plan-summary";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireAdmin();

  const [
    summary,
    directory,
    recentVisits,
    topPaths,
    daily,
    waitlist,
    featureAccess,
    accountAccess,
  ] = await Promise.all([
    getAdminSummary(),
    getUserDirectory(),
    getRecentVisits(60),
    getTopPaths(30, 15),
    getDailyTraffic(30),
    listAccessRequests(),
    getAdminFeatureAccessData(),
    getAdminAccountAccessData(),
  ]);

  const accountAccessMap = new Map(accountAccess.map((acc) => [acc.id, acc]));

  const mergedUsers = directory.map((u) => {
    const acc = accountAccessMap.get(u.id);
    return {
      ...u,
      planId: acc?.planId ?? "free",
      subscriptionStatus: acc?.subscriptionStatus ?? "canceled",
      provider: acc?.provider ?? null,
    };
  });

  return (
    <AppChrome user={user} sidebar>
      <div className="product-scope min-h-full">
        <AdminConsoleClient
          currentUser={{ id: user.id, email: user.email }}
          summary={summary}
          plans={buildAdminPlanSummary(accountAccess)}
          users={mergedUsers}
          daily={daily}
          topPaths={topPaths}
          recentVisits={recentVisits}
          featureAccess={featureAccess}
          waitlist={waitlist}
        />
      </div>
    </AppChrome>
  );
}
