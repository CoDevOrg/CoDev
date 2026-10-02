import { CursorLogo } from "@/components/gen2/provider-logos";
import { ProviderAccountCard } from "@/components/settings/provider-account-card";
import { ClaudeMark, OpenAIMark } from "@/components/settings/provider-logos";
import {
  SettingsPageHeader,
  SettingsPageShell,
} from "@/components/settings/settings-style";
import { isHostedClaudeConnectEnabled } from "@/lib/providers/claude-connection-runner";
import { isHostedCodexSubscriptionEnabled } from "@/lib/providers/hosted-codex-subscription-flag";
import { loadProviderConnectionSnapshot } from "@/lib/providers/provider-connection-server";
import { providerRunsIn } from "@/lib/providers/provider-surface-capability";
import { requireUser } from "@/lib/auth/session";

const CARDS = [
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
    logo: <CursorLogo className="size-5" size={20} />,
    subscription: "cursor",
    connection: "cursor",
  },
] as const;

/**
 * One card per agent account, each stating where it runs.
 *
 * This page used to be two segmented tabs — "Chat rooms" and "Coding
 * workspaces" — each with its own copy of every provider and its own prose
 * about which sign-ins reached it. That split was built on a rule that is no
 * longer true (a browser sign-in never reaches a shared host: Codex's does),
 * and it asked the member to know which surface they were configuring before
 * they could connect anything. Worse, the per-surface prose had to be kept
 * true by hand against the resolvers, and it lost: a Claude setup-token was
 * advertised as ready for chat rooms that cannot run it.
 *
 * So the member connects an account, and CoDev says where it works —
 * `providerRunsIn` reads the same registry the server resolves turns from,
 * so the two cannot disagree. The one thing still worth asking is whether a
 * personal login may fund a turn inside a workspace other people can see,
 * which lives on the card as a single switch.
 */
export default async function PersonalProvidersPage() {
  const user = await requireUser();
  const snapshot = await loadProviderConnectionSnapshot(user);
  const hostedClaudeConnect = isHostedClaudeConnectEnabled();
  const hostedOpenAIConnect = isHostedCodexSubscriptionEnabled();

  return (
    <SettingsPageShell>
      <SettingsPageHeader
        badge="Optional"
        description="Connect the accounts your agents run on. Each card shows where that account can be used once it is connected. Everything is encrypted on the CoDev server and never shown again after you save it."
        title="AI Provider Accounts"
      />
      <div className="flex flex-col gap-3">
        {CARDS.map((card) => {
          const subscription = snapshot.cliSubscriptions.find(
            (row) => row.provider === card.subscription,
          );
          const connection = snapshot.connections.find(
            (row) => row.provider === card.connection,
          );
          if (!subscription || !connection) return null;
          return (
            <ProviderAccountCard
              claudeCliToken={snapshot.claudeCliToken}
              connection={connection}
              hostedClaudeConnect={
                hostedClaudeConnect && card.connection === "anthropic"
              }
              hostedOpenAIConnect={
                hostedOpenAIConnect && card.connection === "openai"
              }
              key={card.label}
              label={card.label}
              logo={card.logo}
              runsIn={providerRunsIn(snapshot, card.connection)}
              subscription={subscription}
            />
          );
        })}
      </div>
    </SettingsPageShell>
  );
}
