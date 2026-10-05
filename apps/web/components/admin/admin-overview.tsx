"use client";

import {
  Users,
  Activity,
  Eye,
  Globe,
  TrendingUp,
  UserCheck,
  Compass,
  Clock,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AdminTrafficChart } from "./admin-traffic-chart";
import { formatNumber, formatRelative } from "./admin-formatters";
import type { AdminSummary } from "@/lib/admin/admin-stats";

type RecentVisit = {
  id: string;
  createdAt: string;
  path: string;
  anon: boolean;
  userName: string | null;
  userEmail: string | null;
};

type TopPath = {
  path: string;
  views: number;
};

export function AdminOverview({
  summary,
  daily,
  topPaths,
  recentVisits,
}: {
  summary: AdminSummary;
  daily: Array<{ day: string; views: number; visitors: number }>;
  topPaths: TopPath[];
  recentVisits: RecentVisit[];
}) {
  const statCards = [
    {
      title: "Total Accounts",
      value: formatNumber(summary.totalUsers),
      hint: `+${summary.newUsers7d} this week · +${summary.newUsers30d} this month`,
      icon: Users,
    },
    {
      title: "Active Now",
      value: formatNumber(summary.activeAccounts30m),
      hint: "Signed-in, last 30 minutes",
      icon: Activity,
      badge: "live",
    },
    {
      title: "Active (24h)",
      value: formatNumber(summary.activeAccounts24h),
      hint: `${formatNumber(summary.activeAccounts7d)} active in last 7 days`,
      icon: UserCheck,
    },
    {
      title: "Page Views (24h)",
      value: formatNumber(summary.views24h),
      hint: `${formatNumber(summary.views7d)} in 7d · ${formatNumber(summary.views30d)} in 30d`,
      icon: Eye,
    },
    {
      title: "Unique Visitors (7d)",
      value: formatNumber(summary.uniqueVisitors7d),
      hint: "Identified by account or IP",
      icon: Globe,
    },
    {
      title: "Total Views (All Time)",
      value: formatNumber(summary.totalViews),
      hint: "Cumulative site-wide views",
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card
              key={stat.title}
              className="flex flex-col justify-between border-border/70 bg-card/60 p-4 backdrop-blur-xs transition-colors hover:border-border"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium tracking-wide uppercase text-muted-foreground">
                  {stat.title}
                </span>
                <div className="flex items-center gap-1.5">
                  {stat.badge === "live" ? (
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                    </span>
                  ) : null}
                  <Icon className="size-4 text-muted-foreground/80" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {stat.value}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground truncate">
                  {stat.hint}
                </p>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Traffic Bar Chart */}
      <AdminTrafficChart daily={daily} />

      {/* Side-by-side Top Pages and Recent Visits */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-5 border-border/80 bg-card/60 backdrop-blur-xs">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Compass className="size-4 text-primary" /> Top Pages (30d)
            </CardTitle>
            <CardDescription className="text-xs">
              Most visited routes across all sessions
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-y border-border/60 bg-muted/30 text-[11px] font-medium uppercase text-muted-foreground">
                    <th className="py-2 pl-4 pr-3">Path</th>
                    <th className="py-2 pl-3 pr-4 text-right">Views</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {topPaths.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-6 text-center text-muted-foreground">
                        No traffic data yet.
                      </td>
                    </tr>
                  ) : (
                    topPaths.map((row) => (
                      <tr key={row.path} className="hover:bg-muted/20">
                        <td className="py-2 pl-4 pr-3">
                          <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                            {row.path}
                          </code>
                        </td>
                        <td className="py-2 pl-3 pr-4 text-right font-medium text-foreground">
                          {formatNumber(row.views)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-7 border-border/80 bg-card/60 backdrop-blur-xs">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="size-4 text-primary" /> Recent Visits
            </CardTitle>
            <CardDescription className="text-xs">
              Live stream of latest visits to the platform
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs">
                  <tr className="border-y border-border/60 bg-muted/30 text-[11px] font-medium uppercase text-muted-foreground">
                    <th className="py-2 pl-4 pr-3">When</th>
                    <th className="px-3 py-2">Visitor</th>
                    <th className="py-2 pl-3 pr-4">Path</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {recentVisits.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-muted-foreground">
                        No recent visits recorded.
                      </td>
                    </tr>
                  ) : (
                    recentVisits.map((visit) => (
                      <tr key={visit.id} className="hover:bg-muted/20">
                        <td className="py-2 pl-4 pr-3 whitespace-nowrap text-muted-foreground">
                          {formatRelative(visit.createdAt)}
                        </td>
                        <td className="px-3 py-2">
                          {visit.anon ? (
                            <span className="text-muted-foreground italic">anonymous</span>
                          ) : (
                            <span className="font-medium text-foreground">
                              {visit.userName ?? visit.userEmail ?? "account"}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pl-3 pr-4">
                          <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                            {visit.path}
                          </code>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
