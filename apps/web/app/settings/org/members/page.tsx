import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
} from "@/components/settings/settings-content";
import { getActiveOrganizationSettingsContext } from "@/lib/admin/organization-settings";
import { requireUser } from "@/lib/auth/session";

export default async function OrganizationMembersPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);

  return (
    <OrganizationSettingsPage
      context={context}
      description="Review organization members and manage their access."
      title="Members"
    >
      <OrganizationSettingsCard
        context={context}
        description="Member invites and role changes are protected by the organization write guard."
        detail="Owners and Admins will be able to invite members and assign access roles here."
        title="Organization access"
      />
    </OrganizationSettingsPage>
  );
}
