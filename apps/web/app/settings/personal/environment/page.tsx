import { EnvironmentVariablesPanel } from "@/components/settings/environment-variables-panel";
import {
  OrcaPageHeader,
  OrcaPageShell,
} from "@/components/settings/orca-style";
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
      <EnvironmentVariablesPanel initialVariables={variables} />
    </OrcaPageShell>
  );
}
