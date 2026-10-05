"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";

import {
  updateOrganizationFeatureOverride,
  updateUserFeatureOverride,
  type AdminFeatureActionResult,
} from "@/app/admin/actions";
import { AdminFeatureFields } from "@/components/admin/admin-feature-fields";
import { AdminFeatureOverrideLists } from "@/components/admin/admin-feature-override-lists";
import { AdminOrganizationPlanForm } from "@/components/admin/admin-organization-plan-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import type { AdminFeatureAccessData } from "@/lib/admin/admin-feature-access";

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

export function AdminFeatureControls({
  data,
}: {
  data: AdminFeatureAccessData;
}) {
  const firstOrganization = data.organizations[0]?.id ?? "";
  const [organizationId, setOrganizationId] = useState(firstOrganization);
  const [userOrganizationId, setUserOrganizationId] =
    useState(firstOrganization);
  const [userId, setUserId] = useState(
    data.members.find((member) => member.organizationId === firstOrganization)
      ?.userId ?? "",
  );
  const [organizationResult, setOrganizationResult] =
    useState<AdminFeatureActionResult | null>(null);
  const [userResult, setUserResult] = useState<AdminFeatureActionResult | null>(
    null,
  );
  const [organizationPending, startOrganizationTransition] = useTransition();
  const [userPending, startUserTransition] = useTransition();

  const userMembers = useMemo(
    () =>
      data.members.filter(
        (member) => member.organizationId === userOrganizationId,
      ),
    [data.members, userOrganizationId],
  );
  const selectedUserId = userMembers.some((member) => member.userId === userId)
    ? userId
    : (userMembers[0]?.userId ?? "");

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
      <Alert className="admin-feature-note" role="status">
        <AlertDescription>
          Application admins have no monthly compute limit on workspaces they
          own. These controls change organization plans and Hosted Codex access;
          member overrides take precedence over organization overrides and
          plans.
        </AlertDescription>
      </Alert>
      <div className="admin-control-grid">
        <AdminOrganizationPlanForm data={data} />
        <Card className="admin-control-card">
          <CardHeader>
            <CardTitle>Override organization access</CardTitle>
            <CardDescription>
              Allow or block Hosted Codex for every member. Member-specific
              overrides still take precedence.
            </CardDescription>
          </CardHeader>
          <form
            onSubmit={(event) =>
              submit(
                event,
                updateOrganizationFeatureOverride,
                startOrganizationTransition,
                setOrganizationResult,
              )
            }
          >
            <CardContent className="admin-control-form-content">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="override-organization">
                    Organization
                  </FieldLabel>
                  <select
                    id="override-organization"
                    className="admin-control-select"
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
                </Field>
                <AdminFeatureFields
                  idPrefix="organization-override"
                  scope="organization"
                />
              </FieldGroup>
              <Notice result={organizationResult} />
            </CardContent>
            <CardFooter className="admin-control-form-footer">
              <Button type="submit" disabled={organizationPending}>
                {organizationPending ? "Applying…" : "Save organization access"}
              </Button>
            </CardFooter>
          </form>
        </Card>
        <Card className="admin-control-card">
          <CardHeader>
            <CardTitle>Override member access</CardTitle>
            <CardDescription>
              Set an exception for one member. Choose “Follow organization
              policy” to remove the exception.
            </CardDescription>
          </CardHeader>
          <form
            onSubmit={(event) =>
              submit(
                event,
                updateUserFeatureOverride,
                startUserTransition,
                setUserResult,
              )
            }
          >
            <CardContent className="admin-control-form-content">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="member-organization">
                    Organization
                  </FieldLabel>
                  <select
                    id="member-organization"
                    className="admin-control-select"
                    name="organizationId"
                    value={userOrganizationId}
                    onChange={(event) => {
                      const organizationId = event.target.value;
                      setUserOrganizationId(organizationId);
                      setUserId(
                        data.members.find(
                          (member) => member.organizationId === organizationId,
                        )?.userId ?? "",
                      );
                    }}
                  >
                    {data.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="member-user">Member</FieldLabel>
                  <select
                    id="member-user"
                    className="admin-control-select"
                    name="userId"
                    required
                    disabled={userMembers.length === 0}
                    value={selectedUserId}
                    onChange={(event) => setUserId(event.target.value)}
                  >
                    {userMembers.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.name ? `${member.name} · ` : ""}@{member.login}{" "}
                        · {member.role}
                      </option>
                    ))}
                  </select>
                  {userMembers.length === 0 ? (
                    <FieldDescription>
                      This organization has no members to override.
                    </FieldDescription>
                  ) : null}
                </Field>
                <AdminFeatureFields idPrefix="member-override" scope="member" />
              </FieldGroup>
              <Notice result={userResult} />
            </CardContent>
            <CardFooter className="admin-control-form-footer">
              <Button
                type="submit"
                disabled={userPending || userMembers.length === 0}
              >
                {userPending ? "Applying…" : "Save member access"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
      <AdminFeatureOverrideLists data={data} />
    </div>
  );
}
