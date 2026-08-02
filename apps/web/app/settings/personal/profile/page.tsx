import { FeedbackForm } from "@/components/feedback-form";
import {
  ProfileSettings,
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/settings-content";
import { requireUser } from "@/lib/session";

export default async function PersonalProfilePage() {
  const user = await requireUser();

  return (
    <div className="settings-page">
      <SettingsPageHeader
        description="Manage the identity and account security details that belong to you."
        eyebrow="Personal settings"
        title="Profile"
      />
      <ProfileSettings user={user} />
      <SettingsCard
        description="Help prioritize the design-partner experience."
        title="Design-partner feedback"
      >
        <FeedbackForm />
      </SettingsCard>
    </div>
  );
}
