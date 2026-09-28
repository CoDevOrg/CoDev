import { EnvironmentVariablesPanel } from "@/components/settings/environment-variables-panel";
import {
  OrcaPageHeader,
  OrcaPageShell,
  OrcaSubsectionHeader,
} from "@/components/settings/orca-style";
import { Card } from "@/components/ui/card";
import { listUserEnvironmentVariables } from "@/lib/providers/user-environment";
import { requireUser } from "@/lib/auth/session";

export default async function PersonalEnvironmentPage() {
  const user = await requireUser();
  const variables = await listUserEnvironmentVariables(user.id);

  return (
    <OrcaPageShell>
      <OrcaPageHeader
        description="Store encrypted key/value pairs for your personal CoDev workflows."
        title="Environment Variables"
      />
      <Card className="space-y-3">
        <OrcaSubsectionHeader
          description="Encrypted at rest. Values are write-only after you save them."
          title="Personal .env"
        />
        <EnvironmentVariablesPanel initialVariables={variables} />
      </Card>
    </OrcaPageShell>
  );
}
