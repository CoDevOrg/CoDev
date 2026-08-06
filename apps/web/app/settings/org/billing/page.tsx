import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
  SettingsCard,
} from "@/components/settings/settings-content";
import { getActiveOrganizationSettingsContext } from "@/lib/organization-settings";
import { requireUser } from "@/lib/session";
import {
  getVmMinutesRemaining,
  getVmMinutesUsed,
  VM_MINUTE_LIFETIME_QUOTA,
} from "@/lib/vm-usage";

export default async function OrganizationBillingPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);
  const [minutesUsed, minutesRemaining] = await Promise.all([
    getVmMinutesUsed(user.id),
    getVmMinutesRemaining(user.id),
  ]);

  return (
    <OrganizationSettingsPage
      context={context}
      description="Beta compute allotment and BYOK model billing."
      title="Billing"
    >
      <SettingsCard
        description="Sandbox runtime is metered against your lifetime allotment. Model tokens bill to your connected Codex, Claude, or Cursor credentials."
        title="VM minutes"
      >
        <p>
          <strong>
            {minutesUsed} / {VM_MINUTE_LIFETIME_QUOTA}
          </strong>{" "}
          lifetime minutes used
        </p>
        <p>{minutesRemaining} minutes remaining</p>
      </SettingsCard>
      <OrganizationSettingsCard
        context={context}
        description="CoDev does not sell model tokens during beta."
        detail="Connect Codex, Claude, or Cursor in Coding agents. Platform AI keys are disabled."
        title="Model spend"
      />
    </OrganizationSettingsPage>
  );
}
