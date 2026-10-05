"use client";

import { useState, useTransition } from "react";

import type { FeatureKey } from "@codev/contracts";

import {
  updateOrganizationFeatureOverride,
  updateUserFeatureOverride,
  type AdminFeatureActionResult,
} from "@/app/admin/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { AdminFeatureAccessData } from "@/lib/admin/admin-feature-access";

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

function formatDate(value: string | null): string {
  if (!value) return "No expiry";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function describeChange(event: AdminFeatureAccessData["auditEvents"][number]) {
  if (event.action === "deleted") {
    return `Removed ${event.previousEnabled ? "allow" : "block"}; returned to inherited access`;
  }
  return `${event.action === "created" ? "Set" : "Changed to"} ${event.enabled ? "allow" : "block"}${
    event.expiresAt ? ` until ${formatDate(event.expiresAt)}` : " indefinitely"
  }`;
}

function Notice({ result }: { result: AdminFeatureActionResult | null }) {
  if (!result) return null;
  return (
    <Alert
      className="admin-action-notice"
      variant={result.ok ? "default" : "destructive"}
      role={result.ok ? "status" : "alert"}
    >
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  );
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
    <>
      <CurrentOverrides
        data={data}
        result={result}
        pendingKey={pending ? removingKey : null}
        onRemove={removeOverride}
      />
      <AuditHistory events={data.auditEvents} />
    </>
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
    data.organizations.map((organization) => [
      organization.id,
      organization.name,
    ]),
  );
  const memberNames = new Map(
    data.members.map((member) => [
      `${member.organizationId}:${member.userId}`,
      `@${member.login}`,
    ]),
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
    <div className="admin-control-table-block">
      <div>
        <h3>Current feature overrides</h3>
        <p className="admin-muted">
          Remove an override to return access to the organization and plan
          rules. Expired overrides are omitted; they remain in the history.
        </p>
      </div>
      <Notice result={result} />
      <div className="admin-table-wrap">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Scope</th>
                <th>Feature</th>
                <th>Access</th>
                <th>Expiry</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="admin-muted">
                    No current overrides. Access comes from organization plans
                    and defaults.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.target}</td>
                    <td className="admin-muted">{row.scopeLabel}</td>
                    <td>{formatFeature(row.feature)}</td>
                    <td>
                      <span
                        className={`admin-badge ${row.enabled ? "status-accepted" : "status-declined"}`}
                      >
                        {row.enabled ? "allowed" : "blocked"}
                      </span>
                    </td>
                    <td className="admin-time">{formatDate(row.expiresAt)}</td>
                    <td className="admin-actions-cell">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pendingKey !== null}
                        onClick={() => onRemove(row)}
                        aria-label={`Remove ${row.scope} override for ${row.target}`}
                      >
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
      </div>
    </div>
  );
}

function AuditHistory({
  events,
}: {
  events: AdminFeatureAccessData["auditEvents"];
}) {
  return (
    <div className="admin-control-table-block">
      <h3>Override history</h3>
      <div className="admin-table-wrap">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Changed</th>
                <th>Target</th>
                <th>Feature</th>
                <th>Change</th>
                <th>Operator</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-muted">
                    No override changes recorded yet.
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event.id}>
                    <td className="admin-time">
                      {formatDate(event.createdAt)}
                    </td>
                    <td>
                      {event.targetUserLogin
                        ? `@${event.targetUserLogin} · `
                        : ""}
                      {event.organizationName}
                    </td>
                    <td>{formatFeature(event.feature)}</td>
                    <td>{describeChange(event)}</td>
                    <td className="admin-muted">
                      {event.actorLogin ? `@${event.actorLogin}` : "System"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
