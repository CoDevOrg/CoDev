import {
  SettingsPageHeader,
  SettingsPlaceholder,
} from "@/components/settings/settings-content";

export default function PersonalIntegrationsPage() {
  return (
    <div className="settings-page">
      <SettingsPageHeader
        description="Connect personal OAuth accounts for work you author in CoDev."
        eyebrow="Personal settings"
        title="Integrations"
      />
      <SettingsPlaceholder
        description="Personal OAuth connections stay private to your account."
        detail="GitHub, Supabase, and Vercel connections for your personal workflow will be managed here."
        title="Personal connections"
      />
    </div>
  );
}
