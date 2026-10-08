"use client";

import { useMemo, useState } from "react";
import { Building2, Users, Shield, Search } from "lucide-react";
import type { AdminFeatureAccessData } from "@/lib/admin/admin-feature-access";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AdminFeatureControls } from "./admin-feature-controls";
import { AdminOrganizationRoleForm } from "./admin-organization-role-form";

export function AdminOrganizationControls({
  featureAccess,
}: {
  featureAccess: AdminFeatureAccessData;
}) {
  const [search, setSearch] = useState("");

  const filteredOrgs = useMemo(() => {
    if (!search.trim()) return featureAccess.organizations;
    const q = search.toLowerCase();
    return featureAccess.organizations.filter(
      (org) =>
        org.name.toLowerCase().includes(q) ||
        (org.slug && org.slug.toLowerCase().includes(q)),
    );
  }, [featureAccess.organizations, search]);

  const orgStats = useMemo(() => {
    const memberCounts = new Map<string, number>();
    for (const m of featureAccess.members) {
      memberCounts.set(
        m.organizationId,
        (memberCounts.get(m.organizationId) ?? 0) + 1,
      );
    }
    const overrideCounts = new Map<string, number>();
    for (const o of featureAccess.organizationOverrides) {
      overrideCounts.set(
        o.organizationId,
        (overrideCounts.get(o.organizationId) ?? 0) + 1,
      );
    }
    return { memberCounts, overrideCounts };
  }, [featureAccess.members, featureAccess.organizationOverrides]);

  return (
    <div className="space-y-6">
      {/* Organizations Directory Card */}
      <Card className="border-border/80 bg-card/60 backdrop-blur-xs">
        <CardHeader className="flex flex-col gap-4 pb-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Building2 className="size-4 text-primary" />
                Organizations Directory
              </CardTitle>
              <CardDescription className="text-xs">
                Active organizations, baseline subscription tiers, and member
                allocations
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="w-fit text-xs text-muted-foreground"
            >
              {filteredOrgs.length} of {featureAccess.organizations.length}{" "}
              organizations
            </Badge>
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search organizations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-y border-border/60 bg-muted/30 text-[11px] font-medium uppercase text-muted-foreground">
                  <th className="py-2.5 pl-4 pr-3">Organization</th>
                  <th className="px-3 py-2.5">Slug</th>
                  <th className="px-3 py-2.5">Baseline Plan</th>
                  <th className="px-3 py-2.5">Members</th>
                  <th className="py-2.5 pl-3 pr-4 text-right">Overrides</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredOrgs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No organizations matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredOrgs.map((org) => {
                    const members = orgStats.memberCounts.get(org.id) ?? 0;
                    const overrides = orgStats.overrideCounts.get(org.id) ?? 0;
                    const plan = featureAccess.plans.find(
                      (p) => p.id === org.planId,
                    );

                    return (
                      <tr key={org.id} className="hover:bg-muted/20">
                        <td className="py-2.5 pl-4 pr-3 font-semibold text-foreground">
                          {org.name}
                        </td>
                        <td className="px-3 py-2.5">
                          <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                            {org.slug || org.id}
                          </code>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge
                            variant={
                              org.planId === "pro" ? "default" : "outline"
                            }
                            className={`text-[10px] font-medium ${
                              org.planId === "pro"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            {plan?.name ?? org.planId}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="size-3 text-muted-foreground" />
                            {members} {members === 1 ? "member" : "members"}
                          </span>
                        </td>
                        <td className="py-2.5 pl-3 pr-4 text-right">
                          {overrides > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-primary/40 bg-primary/10 text-primary text-[10px] px-1.5 py-0"
                            >
                              <Shield className="size-2.5 mr-0.5 inline" />
                              {overrides} active
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-[11px]">
                              Plan defaults
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Member Role Assignment Form */}
      <AdminOrganizationRoleForm
        organizations={featureAccess.organizations}
        members={featureAccess.members}
      />

      {/* Plan Assignment & Feature Override Controls */}
      <AdminFeatureControls data={featureAccess} />
    </div>
  );
}
