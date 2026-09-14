"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";

import type { FeatureKey } from "@codev/contracts";

import {
  updateOrganizationFeatureOverride,
  updateOrganizationPlan,
  updateUserFeatureOverride,
  type AdminFeatureActionResult,
} from "@/app/admin/actions";
import type { AdminFeatureAccessData } from "@/lib/admin-feature-access";

const FEATURES: Array<{ id: FeatureKey; label: string }> = [
  { id: "hosted_codex_subscription", label: "Hosted Codex subscription" },
];
const DEFAULT_FEATURE: FeatureKey = "hosted_codex_subscription";

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
  if (event.action === "deleted") return "Returned to inherited access";
  return `${event.enabled ? "Allowed" : "Blocked"}${
    event.expiresAt ? ` until ${formatDate(event.expiresAt)}` : " indefinitely"
  }`;
}

function Notice({ result }: { result: AdminFeatureActionResult | null }) {
  if (!result) return null;
  return (
    <div className={`inline-alert${result.ok ? "" : " error"}`} role="status">
      {result.message}
    </div>
  );
}

export function AdminFeatureControls({
  data,
}: {
  data: AdminFeatureAccessData;
}) {
  const firstOrganization = data.organizations[0]?.id ?? "";
  const [planOrganizationId, setPlanOrganizationId] =
    useState(firstOrganization);
  const [organizationId, setOrganizationId] = useState(firstOrganization);
  const [userOrganizationId, setUserOrganizationId] =
    useState(firstOrganization);
  const [planResult, setPlanResult] = useState<AdminFeatureActionResult | null>(
    null,
  );
  const [organizationResult, setOrganizationResult] =
    useState<AdminFeatureActionResult | null>(null);
  const [userResult, setUserResult] = useState<AdminFeatureActionResult | null>(
    null,
  );
  const [planPending, startPlanTransition] = useTransition();
  const [organizationPending, startOrganizationTransition] = useTransition();
  const [userPending, startUserTransition] = useTransition();

  const selectedPlan =
    data.organizations.find((item) => item.id === planOrganizationId)?.planId ??
    "free";
  const userMembers = useMemo(
    () =>
      data.members.filter(
        (member) => member.organizationId === userOrganizationId,
      ),
    [data.members, userOrganizationId],
  );

  function submit(
    event: FormEvent<HTMLFormElement>,
    action: (formData: FormData) => Promise<AdminFeatureActionResult>,
    startTransition: (callback: () => Promise<void>) => void,
    setResult: (result: AdminFeatureActionResult | null) => void,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("timezoneOffset", String(new Date().getTimezoneOffset()));
    setResult(null);
    startTransition(async () => setResult(await action(formData)));
  }

  if (data.organizations.length === 0) {
    return <p className="admin-muted">No organizations are available yet.</p>;
  }

  return (
    <div className="admin-feature-controls">
      <div className="admin-control-grid">
        <form
          className="admin-control-card"
          onSubmit={(event) =>
            submit(
              event,
              updateOrganizationPlan,
              startPlanTransition,
              setPlanResult,
            )
          }
        >
          <div>
            <h3>Plan assignment</h3>
            <p>Set the subscription tier that supplies baseline access.</p>
          </div>
          <label>
            Organization
            <select
              name="organizationId"
              value={planOrganizationId}
              onChange={(event) => setPlanOrganizationId(event.target.value)}
            >
              {data.organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Plan
            <select
              name="planId"
              key={`${planOrganizationId}:${selectedPlan}`}
              defaultValue={selectedPlan}
            >
              {data.plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
          <button className="admin-btn primary" disabled={planPending}>
            {planPending ? "Saving…" : "Save plan"}
          </button>
          <Notice result={planResult} />
        </form>

        <form
          className="admin-control-card"
          onSubmit={(event) =>
            submit(
              event,
              updateOrganizationFeatureOverride,
              startOrganizationTransition,
              setOrganizationResult,
            )
          }
        >
          <div>
            <h3>Organization override</h3>
            <p>Allow or block a feature for everyone in one organization.</p>
          </div>
          <label>
            Organization
            <select
              name="organizationId"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              {data.organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <FeatureFields />
          <button className="admin-btn primary" disabled={organizationPending}>
            {organizationPending ? "Saving…" : "Save override"}
          </button>
          <Notice result={organizationResult} />
        </form>

        <form
          className="admin-control-card"
          onSubmit={(event) =>
            submit(
              event,
              updateUserFeatureOverride,
              startUserTransition,
              setUserResult,
            )
          }
        >
          <div>
            <h3>User override</h3>
            <p>Grant or remove access for one member of an organization.</p>
          </div>
          <label>
            Organization
            <select
              name="organizationId"
              value={userOrganizationId}
              onChange={(event) => setUserOrganizationId(event.target.value)}
            >
              {data.organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            User
            <select name="userId" required disabled={userMembers.length === 0}>
              {userMembers.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name ? `${member.name} · ` : ""}@{member.login} (
                  {member.role})
                </option>
              ))}
            </select>
          </label>
          <FeatureFields />
          <button
            className="admin-btn primary"
            disabled={userPending || userMembers.length === 0}
          >
            {userPending ? "Saving…" : "Save override"}
          </button>
          <Notice result={userResult} />
        </form>
      </div>

      <CurrentOverrides data={data} />
      <AuditHistory events={data.auditEvents} />
    </div>
  );
}

function FeatureFields() {
  const [state, setState] = useState("inherit");
  return (
    <>
      <label>
        Feature
        <select name="feature" defaultValue={DEFAULT_FEATURE}>
          {FEATURES.map((feature) => (
            <option key={feature.id} value={feature.id}>
              {feature.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Access
        <select
          name="state"
          value={state}
          onChange={(event) => setState(event.target.value)}
        >
          <option value="inherit">Inherit from broader policy</option>
          <option value="enabled">Allow</option>
          <option value="disabled">Block</option>
        </select>
      </label>
      <label>
        Expires (optional)
        <input
          name="expiresAt"
          type="datetime-local"
          disabled={state === "inherit"}
        />
      </label>
    </>
  );
}

function CurrentOverrides({ data }: { data: AdminFeatureAccessData }) {
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
  const rows = [
    ...data.organizationOverrides.map((override) => ({
      key: `org:${override.organizationId}:${override.feature}`,
      target:
        organizationNames.get(override.organizationId) ??
        "Unknown organization",
      scope: "Organization",
      ...override,
    })),
    ...data.userOverrides.map((override) => ({
      key: `user:${override.organizationId}:${override.userId}:${override.feature}`,
      target:
        memberNames.get(`${override.organizationId}:${override.userId}`) ??
        "Unknown user",
      scope: organizationNames.get(override.organizationId) ?? "Organization",
      ...override,
    })),
  ];

  return (
    <div className="admin-control-table-block">
      <h3>Active overrides</h3>
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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-muted">
                    No targeted overrides. Access comes from plans and defaults.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.target}</td>
                    <td className="admin-muted">{row.scope}</td>
                    <td>{formatFeature(row.feature)}</td>
                    <td>
                      <span
                        className={`admin-badge ${row.enabled ? "status-accepted" : "status-declined"}`}
                      >
                        {row.enabled ? "allowed" : "blocked"}
                      </span>
                    </td>
                    <td className="admin-time">{formatDate(row.expiresAt)}</td>
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
