import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
} from "@/components/settings/settings-content";
import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { requireUser } from "@/lib/session";

export default async function OrganizationGeneralPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);

  return (
    <OrganizationSettingsPage
      context={context}
      description="Configure the shared identity, domains, and defaults for your workspace."
      title="Organization settings"
    >
      <OrganizationSettingsCard
        context={context}
        description="These defaults apply across the active workspace."
        detail="Organization name, slug, domain restrictions, and default member roles will be configured here."
        title="Workspace identity"
      />
    </OrganizationSettingsPage>
  );
}
