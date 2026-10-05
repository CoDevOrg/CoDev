"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Key, UserCheck, ShieldCheck } from "lucide-react";

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
import { AdminNotice } from "./admin-notice";

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
    return (
      <div className="rounded-lg border border-dashed border-border/80 p-8 text-center text-sm text-muted-foreground">
        No organizations are available yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Alert
        className="border-primary/30 bg-primary/5 text-primary"
        role="status"
      >
        <ShieldCheck className="size-4 text-primary" />
        <AlertDescription className="text-xs">
          Application admins have no monthly compute limit on workspaces they
          own. These controls govern organization baseline plans and Hosted
          Codex access. Member-specific overrides take precedence over
          organization rules.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AdminOrganizationPlanForm data={data} />

        <Card className="flex flex-col justify-between border-border/80 bg-card/60 backdrop-blur-xs">
          <div>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Key className="size-4 text-primary" />
                Override Organization Access
              </CardTitle>
              <CardDescription className="text-xs">
                Allow or block Hosted Codex for all members in an organization.
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
              <CardContent className="space-y-3 pb-4">
                <FieldGroup className="space-y-3">
                  <Field>
                    <FieldLabel
                      htmlFor="override-organization"
                      className="text-xs font-medium"
                    >
                      Organization
                    </FieldLabel>
                    <select
                      id="override-organization"
                      className="w-full rounded-md border border-input bg-card px-3 py-2 text-xs text-foreground shadow-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
                      name="organizationId"
                      value={organizationId}
                      onChange={(event) =>
                        setOrganizationId(event.target.value)
                      }
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
                <AdminNotice result={organizationResult} />
              </CardContent>
              <CardFooter className="border-t border-border/60 pt-3">
                <Button
                  type="submit"
                  size="sm"
                  disabled={organizationPending}
                  className="text-xs"
                >
                  {organizationPending
                    ? "Applying…"
                    : "Save Organization Access"}
                </Button>
              </CardFooter>
            </form>
          </div>
        </Card>

        <Card className="flex flex-col justify-between border-border/80 bg-card/60 backdrop-blur-xs">
          <div>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <UserCheck className="size-4 text-primary" />
                Override Member Access
              </CardTitle>
              <CardDescription className="text-xs">
                Set a specific exception for one member within an organization.
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
              <CardContent className="space-y-3 pb-4">
                <FieldGroup className="space-y-3">
                  <Field>
                    <FieldLabel
                      htmlFor="member-organization"
                      className="text-xs font-medium"
                    >
                      Organization
                    </FieldLabel>
                    <select
                      id="member-organization"
                      className="w-full rounded-md border border-input bg-card px-3 py-2 text-xs text-foreground shadow-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
                      name="organizationId"
                      value={userOrganizationId}
                      onChange={(event) => {
                        const organizationId = event.target.value;
                        setUserOrganizationId(organizationId);
                        setUserId(
                          data.members.find(
                            (member) =>
                              member.organizationId === organizationId,
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
                    <FieldLabel
                      htmlFor="member-user"
                      className="text-xs font-medium"
                    >
                      Member
                    </FieldLabel>
                    <select
                      id="member-user"
                      className="w-full rounded-md border border-input bg-card px-3 py-2 text-xs text-foreground shadow-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                      name="userId"
                      required
                      disabled={userMembers.length === 0}
                      value={selectedUserId}
                      onChange={(event) => setUserId(event.target.value)}
                    >
                      {userMembers.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.name ? `${member.name} · ` : ""}@
                          {member.login} ({member.role})
                        </option>
                      ))}
                    </select>
                    {userMembers.length === 0 ? (
                      <FieldDescription className="text-[11px] text-muted-foreground mt-1">
                        This organization has no members to override.
                      </FieldDescription>
                    ) : null}
                  </Field>
                  <AdminFeatureFields
                    idPrefix="member-override"
                    scope="member"
                  />
                </FieldGroup>
                <AdminNotice result={userResult} />
              </CardContent>
              <CardFooter className="border-t border-border/60 pt-3">
                <Button
                  type="submit"
                  size="sm"
                  disabled={userPending || userMembers.length === 0}
                  className="text-xs"
                >
                  {userPending ? "Applying…" : "Save Member Access"}
                </Button>
              </CardFooter>
            </form>
          </div>
        </Card>
      </div>

      <AdminFeatureOverrideLists data={data} />
    </div>
  );
}
