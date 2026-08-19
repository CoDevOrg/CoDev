import { CliAccountSection } from "@/components/settings/cli-account-section";
import { ProviderConnectionsPanel } from "@/components/settings/provider-connections-panel";
import {
  OrcaCard,
  OrcaPageHeader,
  OrcaPageShell,
  OrcaSubsectionHeader,
} from "@/components/settings/orca-style";
import { loadProviderConnectionSnapshot } from "@/lib/provider-connection-server";
import { requireUser } from "@/lib/session";

export default async function PersonalProvidersPage() {
  const user = await requireUser();
  const snapshot = await loadProviderConnectionSnapshot(user);
  const claude = snapshot.cliSubscriptions.find((s) => s.provider === "claude");
  const codex = snapshot.cliSubscriptions.find((s) => s.provider === "codex");

  return (
    <OrcaPageShell>
      <OrcaPageHeader
        badge="Optional"
        description="CoDev works with your existing provider logins; add a key only if you want CoDev to help switch between them."
        title="AI Provider Accounts"
      />
      <OrcaCard className="space-y-3">
        <OrcaSubsectionHeader
          description="Sign in with the official CoDev CLI, or paste a personal OpenAI or Anthropic API key instead. Keys stay encrypted on the CoDev server and are never shown after you save them."
          title="Provider connections"
        />
        <ProviderConnectionsPanel initialSnapshot={snapshot} />
      </OrcaCard>
      {claude ? <CliAccountSection subscription={claude} /> : null}
      {codex ? <CliAccountSection subscription={codex} /> : null}
    </OrcaPageShell>
  );
}
