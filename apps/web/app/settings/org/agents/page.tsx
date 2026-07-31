import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
} from "@/components/settings/settings-content";
import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { requireUser } from "@/lib/session";

export default async function OrganizationAgentsPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);

  return (
    <OrganizationSettingsPage
      context={context}
      description="Manage shared provider keys and the fallback credential pool for your workspace."
      title="Coding agents"
    >
      <OrganizationSettingsCard
        context={context}
        description="Team credentials are used only when a member has not configured a personal key."
        detail="Shared Claude, OpenAI, Bedrock, and Cursor credentials will be managed here by Owners and Admins."
        title="Fallback credential pool"
      />
    </OrganizationSettingsPage>
  );
}
