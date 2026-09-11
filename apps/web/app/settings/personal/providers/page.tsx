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
import { isHostedClaudeConnectEnabled } from "@/lib/claude-connection-runner";
import { isHostedCodexSubscriptionEnabled } from "@/lib/hosted-codex-subscription-flag";
import { loadProviderConnectionSnapshot } from "@/lib/provider-connection-server";
import { requireUser } from "@/lib/session";

/**
 * Every agent account a member can bring lives on this one page. Cursor signs
 * in with a browser subscription flow; Claude connects through its official
 * runtime login and ChatGPT through OpenAI's device-code flow. An API key or
 * the CoDev CLI remains available as a fallback for each.
 */
export default async function PersonalProvidersPage() {
  const user = await requireUser();
  const snapshot = await loadProviderConnectionSnapshot(user);
  const hostedClaudeConnect = isHostedClaudeConnectEnabled();
  const hostedOpenAIConnect = isHostedCodexSubscriptionEnabled();

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
        description="Connect the accounts your agents run on. Sign in with your Claude, ChatGPT, or Cursor subscription right in the browser — no terminal needed — or fall back to an API key or the CoDev CLI. Everything is encrypted on the CoDev server and never shown again after you save it."
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
            hostedClaudeConnect={
              hostedClaudeConnect && card.connection === "anthropic"
            }
            hostedOpenAIConnect={
              hostedOpenAIConnect && card.connection === "openai"
            }
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
