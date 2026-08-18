import { EnvironmentVariablesPanel } from "@/components/environment-variables-panel";
import {
  OrcaCard,
  OrcaPageHeader,
  OrcaPageShell,
  OrcaSubsectionHeader,
} from "@/components/settings/orca-style";
import { listUserEnvironmentVariables } from "@/lib/user-environment";
import { requireUser } from "@/lib/session";

export default async function PersonalEnvironmentPage() {
  const user = await requireUser();
  const variables = await listUserEnvironmentVariables(user.id);

  return (
    <OrcaPageShell>
      <OrcaPageHeader
        description="Store encrypted key/value pairs for your personal CoDev workflows."
        title="Environment Variables"
      />
      <OrcaCard className="space-y-3">
        <OrcaSubsectionHeader
          description="Encrypted at rest. Values are write-only after you save them."
          title="Personal .env"
        />
        <EnvironmentVariablesPanel initialVariables={variables} />
      </OrcaCard>
    </OrcaPageShell>
  );
}
