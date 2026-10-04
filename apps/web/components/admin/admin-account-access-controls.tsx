"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";

import type { OrganizationRole } from "@codev/contracts";

import {
  updateAccountSubscription,
  updateApplicationAdmin,
  updateOrganizationMemberRole,
  type AdminFeatureActionResult,
} from "@/app/admin/actions";
import type { AdminAccountAccessData } from "@/lib/admin/admin-account-access";

type Member = {
  organizationId: string;
  userId: string;
  login: string;
  name: string | null;
  role: string;
};

type Organization = { id: string; name: string };

function Notice({ result }: { result: AdminFeatureActionResult | null }) {
  if (!result) return null;
  return (
    <div className={`inline-alert${result.ok ? "" : " error"}`} role="status">
      {result.message}
    </div>
  );
}

function submit(
  event: FormEvent<HTMLFormElement>,
  action: (formData: FormData) => Promise<AdminFeatureActionResult>,
  start: (callback: () => Promise<void>) => void,
  setResult: (result: AdminFeatureActionResult | null) => void,
) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  setResult(null);
  start(async () => setResult(await action(formData)));
}

export function AdminAccountAccessControls({
  accounts,
  members,
  organizations,
}: {
  accounts: AdminAccountAccessData;
  members: Member[];
  organizations: Organization[];
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [organizationId, setOrganizationId] = useState(
    organizations[0]?.id ?? "",
  );
  const [subscriptionResult, setSubscriptionResult] =
    useState<AdminFeatureActionResult | null>(null);
  const [adminResult, setAdminResult] =
    useState<AdminFeatureActionResult | null>(null);
  const [roleResult, setRoleResult] = useState<AdminFeatureActionResult | null>(
    null,
  );
  const [subscriptionPending, startSubscription] = useTransition();
  const [adminPending, startAdmin] = useTransition();
  const [rolePending, startRole] = useTransition();
  const account = accounts.find((item) => item.id === accountId);
  const organizationMembers = useMemo(
    () => members.filter((member) => member.organizationId === organizationId),
    [members, organizationId],
  );

  if (accounts.length === 0) return null;

  return (
    <div className="admin-feature-controls">
      <div className="admin-control-grid">
        <form
          className="admin-control-card"
          onSubmit={(event) =>
            submit(
              event,
              updateAccountSubscription,
              startSubscription,
              setSubscriptionResult,
            )
          }
        >
          <div>
            <h3>Account subscription</h3>
            <p>
              Grant complimentary Individual access or cancel and revoke an
              account&apos;s subscription.
            </p>
          </div>
          <AccountSelect
            accountId={accountId}
            accounts={accounts}
            onChange={setAccountId}
          />
          <p className="admin-muted">
            Current:{" "}
            {account?.planId === "pro" ? "Individual" : account?.planId} ·{" "}
            {account?.subscriptionStatus}{" "}
            {account?.provider ? `(${account.provider})` : ""}
          </p>
          <label>
            Change
            <select name="action" defaultValue="grant">
              <option value="grant">
                Grant complimentary Individual access
              </option>
              <option value="revoke">Cancel / revoke access now</option>
            </select>
          </label>
          <input type="hidden" name="userId" value={accountId} />
          <button className="admin-btn primary" disabled={subscriptionPending}>
            {subscriptionPending ? "Saving…" : "Update subscription"}
          </button>
          <Notice result={subscriptionResult} />
        </form>

        <form
          className="admin-control-card"
          onSubmit={(event) =>
            submit(event, updateApplicationAdmin, startAdmin, setAdminResult)
          }
        >
          <div>
            <h3>Application administrators</h3>
            <p>
              Control access to this console. The last administrator and your
              own access are protected.
            </p>
          </div>
          <AccountSelect
            accountId={accountId}
            accounts={accounts}
            onChange={setAccountId}
          />
          <input type="hidden" name="userId" value={accountId} />
          <label>
            Console access
            <select
              name="isAdmin"
              defaultValue={account?.isAdmin ? "true" : "false"}
              key={`${accountId}:${account?.isAdmin}`}
            >
              <option value="true">Administrator</option>
              <option value="false">Standard account</option>
            </select>
          </label>
          <button className="admin-btn primary" disabled={adminPending}>
            {adminPending ? "Saving…" : "Update administrator"}
          </button>
          <Notice result={adminResult} />
        </form>

        <form
          className="admin-control-card"
          onSubmit={(event) =>
            submit(
              event,
              updateOrganizationMemberRole,
              startRole,
              setRoleResult,
            )
          }
        >
          <div>
            <h3>Organization permissions</h3>
            <p>
              Set a member&apos;s owner, admin, billing, or standard-member
              role.
            </p>
          </div>
          <label>
            Organization
            <select
              name="organizationId"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Member
            <select name="userId" disabled={organizationMembers.length === 0}>
              {organizationMembers.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name ?? member.login} · {member.role}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role
            <select name="role" defaultValue="member">
              {(
                [
                  "owner",
                  "admin",
                  "billing_admin",
                  "member",
                ] as OrganizationRole[]
              ).map((role) => (
                <option key={role} value={role}>
                  {role.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <button
            className="admin-btn primary"
            disabled={rolePending || organizationMembers.length === 0}
          >
            {rolePending ? "Saving…" : "Update role"}
          </button>
          <Notice result={roleResult} />
        </form>
      </div>
    </div>
  );
}

function AccountSelect({
  accountId,
  accounts,
  onChange,
}: {
  accountId: string;
  accounts: AdminAccountAccessData;
  onChange: (id: string) => void;
}) {
  return (
    <label>
      Account
      <select
        value={accountId}
        onChange={(event) => onChange(event.target.value)}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name ?? account.login}
            {account.email ? ` · ${account.email}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
