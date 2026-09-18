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
import { ProviderSurfaceTabs } from "@/components/settings/provider-surface-tabs";
import { isHostedClaudeConnectEnabled } from "@/lib/providers/claude-connection-runner";
import { isHostedCodexSubscriptionEnabled } from "@/lib/providers/hosted-codex-subscription-flag";
import { loadProviderConnectionSnapshot } from "@/lib/providers/provider-connection-server";
import { providerSurfaceCapability } from "@/lib/providers/provider-surface-capability";
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
    logo: <CursorMark className="size-5" />,
    subscription: "cursor",
    connection: "cursor",
  },
] as const;

/**
 * Two separate provider integrations, one per surface, because the surfaces
 * run on different credential rules:
 *
 *  - Chat rooms run on the member's own account, so a subscription signed in
 *    right in the browser works there.
 *  - Coding workspaces run on a shared host, so a browser sign-in never
 *    reaches them: only an API key or a login made from the member's own
 *    terminal (`codev <provider>-auth`) does.
 *
 * A connection made in one section applies to that section only; the member
 * opts it into the other with a toggle where the method allows. The two
 * surfaces are segmented tabs, not stacked sections — the workspace section
 * used to sit below the fold every time.
 */
export default async function PersonalProvidersPage() {
  const user = await requireUser();
  const snapshot = await loadProviderConnectionSnapshot(user);
  const hostedClaudeConnect = isHostedClaudeConnectEnabled();
  const hostedOpenAIConnect = isHostedCodexSubscriptionEnabled();

  const sections = [
    {
      id: "chat-rooms",
      surface: "rooms",
      label: "Chat rooms",
      description:
        "Sign in with your Claude, ChatGPT, or Cursor subscription right in the browser — no terminal needed — or connect from your own terminal with the CoDev CLI.",
    },
    {
      id: "coding-workspaces",
      surface: "workspace",
      label: "Coding workspaces",
      description:
        "Workspaces run on a shared host, so a browser sign-in never reaches them. Connect with an API key, or sign in from your own terminal with the CoDev CLI.",
    },
  ] as const;

  return (
    <OrcaPageShell>
      <OrcaPageHeader
        badge="Optional"
        description="Connect the accounts your agents run on. Chat rooms and coding workspaces are set up separately; a connection made in one can be enabled for the other where the sign-in method allows. Everything is encrypted on the CoDev server and never shown again after you save it."
        title="AI Provider Accounts"
      />
      <ProviderSurfaceTabs
        tabs={sections.map((section) => ({
          id: section.id,
          label: section.label,
          description: section.description,
          content: (
            <>
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
                    capability={providerSurfaceCapability(
                      snapshot,
                      card.connection,
                    )}
                    claudeCliToken={snapshot.claudeCliToken}
                    connection={connection}
                    hostedClaudeConnect={
                      hostedClaudeConnect && card.connection === "anthropic"
                    }
                    hostedOpenAIConnect={
                      hostedOpenAIConnect && card.connection === "openai"
                    }
                    key={`${section.id}-${card.label}`}
                    label={card.label}
                    logo={card.logo}
                    subscription={subscription}
                    surface={section.surface}
                  />
                );
              })}
            </>
          ),
        }))}
      />
    </OrcaPageShell>
  );
}
