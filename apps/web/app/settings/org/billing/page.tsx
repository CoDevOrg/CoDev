import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
} from "@/components/settings/settings-content";
import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { requireUser } from "@/lib/session";

export default async function OrganizationBillingPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);

  return (
    <OrganizationSettingsPage
      context={context}
      description="Review subscriptions, token budgets, and compute seats for the workspace."
      title="Billing"
    >
      <OrganizationSettingsCard
        context={context}
        description="Billing and usage controls are visible to all members and editable by Owners and Admins."
        detail="Subscription status, token budgets, and compute seat allocation will be shown here."
        title="Plan and usage"
      />
    </OrganizationSettingsPage>
  );
}
