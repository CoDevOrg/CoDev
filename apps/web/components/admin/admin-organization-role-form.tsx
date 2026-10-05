"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import type { OrganizationRole } from "@codev/contracts";

import { updateOrganizationMemberRole } from "@/app/admin/actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { AdminNotice, type AdminNoticeResult } from "./admin-notice";

type Member = {
  organizationId: string;
  userId: string;
  login: string;
  name: string | null;
  role: string;
};

type Organization = { id: string; name: string };

export function AdminOrganizationRoleForm({
  organizations,
  members,
}: {
  organizations: Organization[];
  members: Member[];
}) {
  const [organizationId, setOrganizationId] = useState(
    organizations[0]?.id ?? "",
  );
  const [result, setResult] = useState<AdminNoticeResult>(null);
  const [pending, startTransition] = useTransition();

  const organizationMembers = useMemo(
    () => members.filter((member) => member.organizationId === organizationId),
    [members, organizationId],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setResult(null);
    startTransition(async () =>
      setResult(await updateOrganizationMemberRole(formData)),
    );
  }

  if (organizations.length === 0) return null;

  return (
    <Card className="border-border/80 bg-card/60 backdrop-blur-xs">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">
          Organization Permissions
        </CardTitle>
        <CardDescription className="text-xs">
          Set a member&apos;s owner, admin, billing, or standard-member role
          within an organization.
        </CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-3">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="role-organization" className="text-xs">
                Organization
              </FieldLabel>
              <select
                id="role-organization"
                name="organizationId"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                className="w-full rounded-md border border-border/80 bg-card px-3 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field>
              <FieldLabel htmlFor="role-member" className="text-xs">
                Member
              </FieldLabel>
              <select
                id="role-member"
                name="userId"
                disabled={organizationMembers.length === 0}
                className="w-full rounded-md border border-border/80 bg-card px-3 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                {organizationMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name ? `${member.name} · ` : ""}@{member.login} (
                    {member.role})
                  </option>
                ))}
              </select>
            </Field>

            <Field>
              <FieldLabel htmlFor="role-select" className="text-xs">
                Role
              </FieldLabel>
              <select
                id="role-select"
                name="role"
                defaultValue="member"
                className="w-full rounded-md border border-border/80 bg-card px-3 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
              >
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
            </Field>
          </FieldGroup>
          <AdminNotice result={result} />
        </CardContent>
        <CardFooter className="border-t border-border/60 pt-3">
          <Button
            type="submit"
            size="sm"
            disabled={pending || organizationMembers.length === 0}
            className="text-xs"
          >
            {pending ? "Updating…" : "Update Member Role"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
