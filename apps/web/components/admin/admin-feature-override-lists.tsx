"use client";

import { useState, useTransition } from "react";
import { Shield, X } from "lucide-react";
import type { FeatureKey } from "@codev/contracts";

import {
  updateOrganizationFeatureOverride,
  updateUserFeatureOverride,
  type AdminFeatureActionResult,
} from "@/app/admin/actions";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdminFeatureAccessData } from "@/lib/admin/admin-feature-access";
import { AdminNotice } from "./admin-notice";
import { formatDateTime as formatDate } from "./admin-formatters";
import { AdminOverrideAuditHistory } from "./admin-override-audit-history";

type FeatureOverrideRow = {
  key: string;
  scope: "organization" | "member";
  organizationId: string;
  userId?: string;
  target: string;
  scopeLabel: string;
  feature: FeatureKey;
  enabled: boolean;
  expiresAt: string | null;
};

const FEATURES: Array<{ id: FeatureKey; label: string }> = [
  { id: "hosted_codex_subscription", label: "Hosted Codex subscription" },
];

function formatFeature(feature: FeatureKey): string {
  return FEATURES.find((item) => item.id === feature)?.label ?? feature;
}

export function AdminFeatureOverrideLists({
  data,
}: {
  data: AdminFeatureAccessData;
}) {
  const [result, setResult] = useState<AdminFeatureActionResult | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function removeOverride(row: FeatureOverrideRow) {
    const formData = new FormData();
    formData.set("organizationId", row.organizationId);
    formData.set("feature", row.feature);
    formData.set("state", "inherit");
    if (row.userId) formData.set("userId", row.userId);
    setResult(null);
    setRemovingKey(row.key);
    startTransition(async () => {
      const action = row.userId
        ? updateUserFeatureOverride
        : updateOrganizationFeatureOverride;
      setResult(await action(formData));
      setRemovingKey(null);
    });
  }

  return (
    <div className="space-y-6">
      <CurrentOverrides
        data={data}
        result={result}
        pendingKey={pending ? removingKey : null}
        onRemove={removeOverride}
      />
      <AdminOverrideAuditHistory events={data.auditEvents} />
    </div>
  );
}

function CurrentOverrides({
  data,
  result,
  pendingKey,
  onRemove,
}: {
  data: AdminFeatureAccessData;
  result: AdminFeatureActionResult | null;
  pendingKey: string | null;
  onRemove: (row: FeatureOverrideRow) => void;
}) {
  const organizationNames = new Map(
    data.organizations.map((org) => [org.id, org.name]),
  );
  const memberNames = new Map(
    data.members.map((m) => [`${m.organizationId}:${m.userId}`, `@${m.login}`]),
  );

  const rows: FeatureOverrideRow[] = [
    ...data.organizationOverrides.map((override) => ({
      ...override,
      key: `org:${override.organizationId}:${override.feature}`,
      scope: "organization" as const,
      organizationId: override.organizationId,
      target:
        organizationNames.get(override.organizationId) ??
        "Unknown organization",
      scopeLabel: "Organization",
    })),
    ...data.userOverrides.map((override) => ({
      ...override,
      key: `user:${override.organizationId}:${override.userId}:${override.feature}`,
      scope: "member" as const,
      organizationId: override.organizationId,
      userId: override.userId,
      target:
        memberNames.get(`${override.organizationId}:${override.userId}`) ??
        "Unknown user",
      scopeLabel:
        organizationNames.get(override.organizationId) ??
        "Unknown organization",
    })),
  ];

  return (
    <Card className="border-border/80 bg-card/60 backdrop-blur-xs">
      <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="size-4 text-primary" /> Active Feature Overrides
          </CardTitle>
          <CardDescription className="text-xs">
            Remove an override to return access to baseline organization plan
            rules.
          </CardDescription>
        </div>
        <Badge
          variant="outline"
          className="w-fit text-xs text-muted-foreground"
        >
          {rows.length} {rows.length === 1 ? "override" : "overrides"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <div className="px-6">
          <AdminNotice result={result} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-y border-border/60 bg-muted/30 text-[11px] font-medium uppercase text-muted-foreground">
                <th className="py-2.5 pl-4 pr-3">Target</th>
                <th className="px-3 py-2.5">Scope</th>
                <th className="px-3 py-2.5">Feature</th>
                <th className="px-3 py-2.5">Access</th>
                <th className="px-3 py-2.5">Expiry</th>
                <th className="py-2.5 pl-3 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No active overrides. Access comes directly from organization
                    plans.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.key} className="hover:bg-muted/20">
                    <td className="py-2.5 pl-4 pr-3 font-semibold text-foreground">
                      {row.target}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant="outline"
                        className="text-[10px] text-muted-foreground"
                      >
                        {row.scopeLabel}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {formatFeature(row.feature)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-semibold capitalize ${
                          row.enabled
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-destructive/40 bg-destructive/10 text-destructive"
                        }`}
                      >
                        {row.enabled ? "allowed" : "blocked"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatDate(row.expiresAt)}
                    </td>
                    <td className="py-2.5 pl-3 pr-4 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pendingKey !== null}
                        onClick={() => onRemove(row)}
                        aria-label={`Remove ${row.scope} override for ${row.target}`}
                        className="h-7 text-xs gap-1"
                      >
                        <X className="size-3" />
                        {pendingKey === row.key
                          ? "Removing…"
                          : "Remove override"}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
