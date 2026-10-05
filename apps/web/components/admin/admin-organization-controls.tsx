"use client";

import { Building2 } from "lucide-react";
import type { AdminFeatureAccessData } from "@/lib/admin/admin-feature-access";
import { AdminFeatureControls } from "./admin-feature-controls";
import { AdminOrganizationRoleForm } from "./admin-organization-role-form";

export function AdminOrganizationControls({
  featureAccess,
}: {
  featureAccess: AdminFeatureAccessData;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Building2 className="size-4 text-primary" />
          Organizations & Entitlements
        </h2>
        <p className="text-xs text-muted-foreground">
          Set baseline organization plans, configure member roles, and manage Hosted Codex overrides.
        </p>
      </div>

      <div className="space-y-6">
        <AdminOrganizationRoleForm
          organizations={featureAccess.organizations}
          members={featureAccess.members}
        />
        <AdminFeatureControls data={featureAccess} />
      </div>
    </div>
  );
}
