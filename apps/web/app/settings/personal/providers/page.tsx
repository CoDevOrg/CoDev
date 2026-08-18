import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/settings-content";
import { ProviderConnectionsPanel } from "@/components/settings/provider-connections-panel";
import { loadProviderConnectionSnapshot } from "@/lib/provider-connection-server";
import { requireUser } from "@/lib/session";

export default async function PersonalProvidersPage() {
  const user = await requireUser();
  const snapshot = await loadProviderConnectionSnapshot(user);

  return (
    <div className="settings-page">
      <SettingsPageHeader
        description="Optional. CoDev works with your existing provider logins; add a key only if you want CoDev to help switch between them."
        eyebrow="Personal settings"
        title="AI Provider Accounts"
      />
      <SettingsCard
        description="Sign in with the official CoDev CLI, or paste a personal OpenAI or Anthropic API key instead. Keys stay encrypted on the CoDev server and are never shown after you save them."
        title="Provider connections"
      >
        <ProviderConnectionsPanel initialSnapshot={snapshot} />
      </SettingsCard>
    </div>
  );
}
