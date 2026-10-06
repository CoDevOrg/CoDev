"use client";

import { History } from "lucide-react";
import type { FeatureKey } from "@codev/contracts";
import type { AdminFeatureAccessData } from "@/lib/admin/admin-feature-access";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateTime as formatDate } from "./admin-formatters";

const FEATURES: Array<{ id: FeatureKey; label: string }> = [
  { id: "hosted_codex_subscription", label: "Hosted Codex subscription" },
];

function formatFeature(feature: FeatureKey): string {
  return FEATURES.find((item) => item.id === feature)?.label ?? feature;
}

function describeChange(event: AdminFeatureAccessData["auditEvents"][number]) {
  if (event.action === "deleted") {
    return `Removed ${event.previousEnabled ? "allow" : "block"}; returned to inherited access`;
  }
  return `${event.action === "created" ? "Set" : "Changed to"} ${event.enabled ? "allow" : "block"}${
    event.expiresAt ? ` until ${formatDate(event.expiresAt)}` : " indefinitely"
  }`;
}

export function AdminOverrideAuditHistory({
  events,
}: {
  events: AdminFeatureAccessData["auditEvents"];
}) {
  return (
    <Card className="border-border/80 bg-card/60 backdrop-blur-xs">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 text-primary" /> Override Audit Trail
        </CardTitle>
        <CardDescription className="text-xs">
          Historical log of all entitlement and access changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[360px] overflow-y-auto overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs">
              <tr className="border-y border-border/60 bg-muted/30 text-[11px] font-medium uppercase text-muted-foreground">
                <th className="py-2.5 pl-4 pr-3">Changed</th>
                <th className="px-3 py-2.5">Target</th>
                <th className="px-3 py-2.5">Feature</th>
                <th className="px-3 py-2.5">Change</th>
                <th className="py-2.5 pl-3 pr-4 text-right">Operator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {events.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No override changes recorded yet.
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event.id} className="hover:bg-muted/20">
                    <td className="whitespace-nowrap py-2.5 pl-4 pr-3 text-muted-foreground">
                      {formatDate(event.createdAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-foreground">
                        {event.targetUserLogin
                          ? `@${event.targetUserLogin} · `
                          : ""}
                      </span>
                      <span className="text-muted-foreground">
                        {event.organizationName}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {formatFeature(event.feature)}
                    </td>
                    <td className="px-3 py-2.5 text-foreground">
                      {describeChange(event)}
                    </td>
                    <td className="py-2.5 pl-3 pr-4 text-right text-muted-foreground">
                      {event.actorLogin ? `@${event.actorLogin}` : "System"}
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
