import {
  SettingsPageHeader,
  SettingsPlaceholder,
} from "@/components/settings/settings-content";

export default function PersonalApiKeysPage() {
  return (
    <div className="settings-page">
      <SettingsPageHeader
        description="Create and revoke credentials for your CoDev CLI and SDK workflows."
        eyebrow="Personal settings"
        title="API keys"
      />
      <SettingsPlaceholder
        description="Programmatic credentials are scoped to your account."
        detail="Your personal CoDev CLI and SDK tokens will appear here with one-time secret display."
        title="Developer access"
      />
    </div>
  );
}
