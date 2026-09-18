import { CliAuthorizationForm } from "@/components/auth/cli-authorization-form";
import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/settings-content";
import { requireUser } from "@/lib/auth/session";

export default async function CliAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  await requireUser();
  const { code } = await searchParams;
  return (
    <main className="settings-page">
      <SettingsPageHeader
        description="Confirm the one-time code displayed by the CoDev CLI."
        eyebrow="Secure terminal connection"
        title="Authorize CoDev CLI"
      />
      <SettingsCard
        description="This approval expires after ten minutes and can only be exchanged once."
        title="Terminal authorization"
      >
        <CliAuthorizationForm initialCode={code ?? ""} />
      </SettingsCard>
    </main>
  );
}
