import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
} from "@/components/settings/settings-content";
import { getActiveOrganizationSettingsContext } from "@/lib/admin/organization-settings";
import { requireUser } from "@/lib/auth/session";

export default async function OrganizationGeneralPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);

  return (
    <OrganizationSettingsPage
      context={context}
      description="Configure shared identity, domains, and defaults for your organization."
      title="Organization settings"
    >
      <OrganizationSettingsCard
        context={context}
        description="These defaults apply across the active organization."
        detail="Organization name, slug, domain restrictions, and default member roles will be configured here."
        title="Organization identity"
      />
    </OrganizationSettingsPage>
  );
}
