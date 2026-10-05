"use client";

import { useState } from "react";
import { BarChart3, Users, Building2, Clock, ShieldCheck } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { AdminOverview } from "./admin-overview";
import {
  AdminUserDirectory,
  type AdminUserDirectoryItem,
} from "./admin-user-directory";
import { AdminOrganizationControls } from "./admin-organization-controls";
import { AdminWaitlist } from "./admin-waitlist";
import type { AdminSummary } from "@/lib/admin/admin-stats";
import type { AdminFeatureAccessData } from "@/lib/admin/admin-feature-access";
import type { AccessRequestRow } from "@/lib/admin/access-requests";

type TabValue = "overview" | "users" | "organizations" | "waitlist";

export function AdminConsoleClient({
  currentUser,
  summary,
  users,
  daily,
  topPaths,
  recentVisits,
  featureAccess,
  waitlist,
}: {
  currentUser: { id: string; email?: string | null | undefined };
  summary: AdminSummary;
  users: AdminUserDirectoryItem[];
  daily: Array<{ day: string; views: number; visitors: number }>;
  topPaths: Array<{ path: string; views: number }>;
  recentVisits: Array<{
    id: string;
    createdAt: string;
    path: string;
    anon: boolean;
    userName: string | null;
    userEmail: string | null;
  }>;
  featureAccess: AdminFeatureAccessData;
  waitlist: AccessRequestRow[];
}) {
  const [activeTab, setActiveTab] = useState<TabValue>("overview");

  const pendingWaitlistCount = waitlist.filter(
    (r) => r.status === "pending",
  ).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* Top Console Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Admin Console
            </h1>
            <Badge
              variant="outline"
              className="gap-1 border-primary/30 bg-primary/10 text-primary text-xs"
            >
              <ShieldCheck className="size-3.5" /> Administrator
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Platform analytics, user directory, and entitlement controls.
          </p>
        </div>

        {currentUser.email ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Signed in as</span>
            <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {currentUser.email}
            </code>
          </div>
        ) : null}
      </div>

      {/* Segmented View Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ToggleGroup
          type="single"
          value={activeTab}
          onValueChange={(val) => {
            if (val) setActiveTab(val as TabValue);
          }}
          className="flex-wrap"
        >
          <ToggleGroupItem
            value="overview"
            className="gap-1.5 px-3 py-1 text-xs"
          >
            <BarChart3 className="size-3.5" />
            <span>Overview</span>
          </ToggleGroupItem>

          <ToggleGroupItem value="users" className="gap-1.5 px-3 py-1 text-xs">
            <Users className="size-3.5" />
            <span>Users</span>
            <span className="ml-1 rounded-full bg-muted/80 px-1.5 py-0.2 text-[10px] text-muted-foreground">
              {users.length}
            </span>
          </ToggleGroupItem>

          <ToggleGroupItem
            value="organizations"
            className="gap-1.5 px-3 py-1 text-xs"
          >
            <Building2 className="size-3.5" />
            <span>Organizations</span>
            <span className="ml-1 rounded-full bg-muted/80 px-1.5 py-0.2 text-[10px] text-muted-foreground">
              {featureAccess.organizations.length}
            </span>
          </ToggleGroupItem>

          <ToggleGroupItem
            value="waitlist"
            className="gap-1.5 px-3 py-1 text-xs"
          >
            <Clock className="size-3.5" />
            <span>Waitlist</span>
            {pendingWaitlistCount > 0 ? (
              <span className="ml-1 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.2 text-[10px] font-semibold">
                {pendingWaitlistCount} pending
              </span>
            ) : (
              <span className="ml-1 rounded-full bg-muted/80 px-1.5 py-0.2 text-[10px] text-muted-foreground">
                {waitlist.length}
              </span>
            )}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === "overview" ? (
          <AdminOverview
            summary={summary}
            daily={daily}
            topPaths={topPaths}
            recentVisits={recentVisits}
          />
        ) : null}

        {activeTab === "users" ? (
          <AdminUserDirectory users={users} currentUserId={currentUser.id} />
        ) : null}

        {activeTab === "organizations" ? (
          <AdminOrganizationControls featureAccess={featureAccess} />
        ) : null}

        {activeTab === "waitlist" ? <AdminWaitlist rows={waitlist} /> : null}
      </div>
    </div>
  );
}
