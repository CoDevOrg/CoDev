import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
} from "@/components/settings/settings-content";
import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { requireUser } from "@/lib/session";

export default async function OrganizationAuditLogPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);

  return (
    <OrganizationSettingsPage
      context={context}
      description="Inspect security events, agent actions, and credential usage for the workspace."
      title="Audit log"
    >
      <OrganizationSettingsCard
        context={context}
        description="Audit history is read-only for every workspace member."
        detail="Security events, agent action logs, and key usage history will appear here with actor and timestamp details."
        title="Workspace activity"
      />
    </OrganizationSettingsPage>
  );
}
