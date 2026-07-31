import {
  SettingsPageHeader,
  SettingsPlaceholder,
} from "@/components/settings/settings-content";

export default function PersonalPreferencesPage() {
  return (
    <div className="settings-page">
      <SettingsPageHeader
        description="Tune the defaults that shape your personal CoDev workspace."
        eyebrow="Personal settings"
        title="Preferences"
      />
      <SettingsPlaceholder
        description="Personal display and agent defaults do not affect teammates."
        detail="Theme, keybindings, and your preferred default model will be available here."
        title="Workspace defaults"
      />
    </div>
  );
}
