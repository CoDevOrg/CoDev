import { EnvironmentVariablesPanel } from "@/components/settings/environment-variables-panel";
import {
  SettingsPageHeader,
  SettingsPageShell,
} from "@/components/settings/settings-style";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      <Card className="flex flex-col gap-4 p-4">
        <CardHeader>
          <CardTitle>Personal .env</CardTitle>
          <CardDescription>
            Encrypted at rest. Values are write-only after you save them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EnvironmentVariablesPanel initialVariables={variables} />
        </CardContent>
      </Card>
    </SettingsPageShell>
  );
}
