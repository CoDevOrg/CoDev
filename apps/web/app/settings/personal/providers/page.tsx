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
 * Every agent account a member can bring lives on this one page. Cursor signs
 * in with a browser subscription flow; Claude and Codex connect with an API
 * key or the CoDev CLI, since Anthropic and OpenAI both block browser OAuth
 * tokens obtained outside their own first-party apps.
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
        description="Connect the accounts your agents run on. Cursor can sign in with your subscription in the browser; Claude and Codex connect with an API key or the CoDev CLI, which signs in through their own official CLI. Everything is encrypted on the CoDev server and never shown again after you save it."
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
