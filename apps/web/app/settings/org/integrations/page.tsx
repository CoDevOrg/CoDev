import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
} from "@/components/settings/settings-content";
import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { requireUser } from "@/lib/session";

export default async function OrganizationIntegrationsPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);

  return (
    <OrganizationSettingsPage
      context={context}
      description="Connect shared services and repositories for your workspace."
      title="Integrations"
    >
      <OrganizationSettingsCard
        context={context}
        description="Team integrations are available to workspace members according to their access."
        detail="GitHub organizations, Supabase projects, Vercel projects, and AWS connections will be configured here."
        title="Shared connections"
      />
    </OrganizationSettingsPage>
  );
}
