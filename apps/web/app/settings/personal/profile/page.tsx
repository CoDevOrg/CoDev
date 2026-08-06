import {
  ProfileSettings,
  SettingsPageHeader,
} from "@/components/settings/settings-content";
import { getConnectedAccounts } from "@/lib/identity";
import { requireUser } from "@/lib/session";

export default async function PersonalProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string }>;
}) {
  const user = await requireUser();
  const connectedAccounts = await getConnectedAccounts(user.id);
  const params = await searchParams;

  return (
    <div className="settings-page">
      <SettingsPageHeader
        description="Manage the identity and account security details that belong to you."
        eyebrow="Personal settings"
        title="Profile"
      />
      <ProfileSettings
        githubStatus={
          params.github === "connected" && connectedAccounts.github.connected
            ? "connected"
            : undefined
        }
        connectedAccounts={connectedAccounts}
        user={user}
      />
    </div>
  );
}
