import Link from "next/link";

import {
  OrganizationSettingsCard,
  OrganizationSettingsPage,
  SettingsCard,
} from "@/components/settings/settings-content";
import { getActiveOrganizationSettingsContext } from "@/lib/admin/organization-settings";
import { requireUser } from "@/lib/auth/session";
import { getBillingStatus } from "@/lib/billing/access";
import {
  getVmMinutesRemaining,
  getVmMinutesUsed,
  VM_MINUTE_LIFETIME_QUOTA,
} from "@/lib/runtime/vm-usage";

export default async function OrganizationBillingPage() {
  const user = await requireUser();
  const context = await getActiveOrganizationSettingsContext(user.id);
  const [minutesUsed, minutesRemaining, billing] = await Promise.all([
    getVmMinutesUsed(user.id),
    getVmMinutesRemaining(user.id),
    getBillingStatus(user.id),
  ]);

  return (
    <OrganizationSettingsPage
      context={context}
      description="Your plan, compute allotment, and BYOK model billing."
      title="Billing"
    >
      <SettingsCard
        description="Subscription and invoices are managed from your personal billing settings."
        title="Plan"
      >
        <p>
          <strong>{billing.planName}</strong>
          {billing.hasAccess ? " · active" : " · not subscribed"}
        </p>
        <p>
          <Link href="/settings/personal/billing">Manage your plan</Link>
        </p>
      </SettingsCard>
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
