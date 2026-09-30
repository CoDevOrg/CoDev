import { EnvironmentVariablesPanel } from "@/components/settings/environment-variables-panel";
import {
  SettingsPageHeader,
  SettingsPageShell,
  SettingsSubsectionHeader,
} from "@/components/settings/settings-style";
import { Card } from "@/components/ui/card";
import { listUserEnvironmentVariables } from "@/lib/providers/user-environment";
import { requireUser } from "@/lib/auth/session";

export default async function PersonalEnvironmentPage() {
  const user = await requireUser();
  const variables = await listUserEnvironmentVariables(user.id);

  return (
    <SettingsPageShell>
      <SettingsPageHeader
        description="Store encrypted key/value pairs for your personal CoDev workflows."
        title="Environment Variables"
      />
      <Card className="space-y-3">
        <SettingsSubsectionHeader
          description="Encrypted at rest. Values are write-only after you save them."
          title="Personal .env"
        />
        <EnvironmentVariablesPanel initialVariables={variables} />
      </Card>
    </SettingsPageShell>
  );
}
