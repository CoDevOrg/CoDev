import { ProviderAccountCard } from "@/components/settings/provider-account-card";
import {
  ClaudeMark,
  CursorMark,
  OpenAIMark,
} from "@/components/settings/provider-logos";
import {
  OrcaPageHeader,
  OrcaPageShell,
} from "@/components/settings/orca-style";
import { loadProviderConnectionSnapshot } from "@/lib/provider-connection-server";
import { requireUser } from "@/lib/session";

/**
 * Every agent account a member can bring lives on this one page, and each one
 * connects from here: no workspace has to be open, no terminal has to be
 * involved, and nothing is hidden behind an org-scoped page. The CLI commands
 * and API-key fields are still available, but as fallbacks under the sign-in
 * button rather than as the only way through.
 */
export default async function PersonalProvidersPage() {
  const user = await requireUser();
  const snapshot = await loadProviderConnectionSnapshot(user);

  const cards = [
    {
      label: "Claude",
      logo: <ClaudeMark className="size-5" />,
      subscription: "claude",
      connection: "anthropic",
    },
    {
      label: "Codex",
      logo: <OpenAIMark className="size-5" />,
      subscription: "codex",
      connection: "openai",
    },
    {
      label: "Cursor",
      logo: <CursorMark className="size-5" />,
      subscription: "cursor",
      connection: "cursor",
    },
  ] as const;

  return (
    <OrcaPageShell>
      <OrcaPageHeader
        badge="Optional"
        description="Connect the accounts your agents run on. Signing in uses your existing Claude, ChatGPT, or Cursor subscription — an API key is only needed if you would rather pay per token. Everything is encrypted on the CoDev server and never shown again after you save it."
        title="AI Provider Accounts"
      />
      {cards.map((card) => {
        const subscription = snapshot.cliSubscriptions.find(
          (row) => row.provider === card.subscription,
        );
        const connection = snapshot.connections.find(
          (row) => row.provider === card.connection,
        );
        if (!subscription || !connection) return null;
        return (
          <ProviderAccountCard
            connection={connection}
            key={card.label}
            label={card.label}
            logo={card.logo}
            subscription={subscription}
          />
        );
      })}
    </OrcaPageShell>
  );
}
