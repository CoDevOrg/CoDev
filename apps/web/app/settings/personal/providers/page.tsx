import { ProviderAccountCard } from "@/components/settings/provider-account-card";
import { ClaudeMark, OpenAIMark } from "@/components/settings/provider-logos";
import {
  OrcaPageHeader,
  OrcaPageShell,
} from "@/components/settings/orca-style";
import { loadProviderConnectionSnapshot } from "@/lib/provider-connection-server";
import { requireUser } from "@/lib/session";

export default async function PersonalProvidersPage() {
  const user = await requireUser();
  const snapshot = await loadProviderConnectionSnapshot(user);

  const openai = snapshot.connections.find((c) => c.provider === "openai");
  const anthropic = snapshot.connections.find(
    (c) => c.provider === "anthropic",
  );
  const codex = snapshot.cliSubscriptions.find((c) => c.provider === "codex");
  const claude = snapshot.cliSubscriptions.find((c) => c.provider === "claude");

  return (
    <OrcaPageShell>
      <OrcaPageHeader
        badge="Optional"
        description="Sign in with the official CoDev CLI, or paste a personal OpenAI or Anthropic API key instead. Keys stay encrypted on the CoDev server and are never shown after you save them."
        title="AI Provider Accounts"
      />
      {anthropic && claude ? (
        <ProviderAccountCard
          cliSubscription={claude}
          connection={anthropic}
          label="Claude"
          logo={<ClaudeMark className="size-5" />}
        />
      ) : null}
      {openai && codex ? (
        <ProviderAccountCard
          cliSubscription={codex}
          connection={openai}
          label="Codex"
          logo={<OpenAIMark className="size-5" />}
        />
      ) : null}
    </OrcaPageShell>
  );
}
