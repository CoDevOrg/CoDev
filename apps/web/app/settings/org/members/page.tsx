import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
} from "@/components/settings/settings-content";
import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { requireUser } from "@/lib/session";

export default async function OrganizationMembersPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);

  return (
    <OrganizationSettingsPage
      context={context}
      description="Review workspace members and manage their organization access."
      title="Members"
    >
      <OrganizationSettingsCard
        context={context}
        description="Member invites and role changes are protected by the organization write guard."
        detail="Owners and Admins will be able to invite members and assign access roles here."
        title="Workspace access"
      />
    </OrganizationSettingsPage>
  );
}
