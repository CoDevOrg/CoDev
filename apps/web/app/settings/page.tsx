import { AppChrome } from "@/components/app-chrome";
import { PersonalSettingsSurface } from "@/components/personal-settings-surface";
import { requireUser } from "@/lib/session";

/**
 * Personal settings, rendered by the same Orca client the workspace uses so
 * a member sees one settings experience whether or not a workspace is open.
 */
export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <AppChrome user={user}>
      <div className="workspace-page">
        <PersonalSettingsSurface />
      </div>
    </AppChrome>
  );
}
