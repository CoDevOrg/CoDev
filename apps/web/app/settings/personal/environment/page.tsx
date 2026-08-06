import { EnvironmentVariablesPanel } from "@/components/environment-variables-panel";
import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/settings-content";
import { listUserEnvironmentVariables } from "@/lib/user-environment";
import { requireUser } from "@/lib/session";

export default async function PersonalEnvironmentPage() {
  const user = await requireUser();
  const variables = await listUserEnvironmentVariables(user.id);

  return (
    <div className="settings-page">
      <SettingsPageHeader
        description="Store encrypted key/value pairs for your personal CoDev workflows."
        eyebrow="Personal settings"
        title="Environment Variables"
      />
      <SettingsCard
        description="Encrypted at rest. Values are write-only after you save them."
        title="Personal .env"
      >
        <EnvironmentVariablesPanel initialVariables={variables} />
      </SettingsCard>
    </div>
  );
}
