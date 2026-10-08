"use client";

import { CursorLogo } from "@/components/gen2/provider-logos";
import { ProviderAccountCard } from "@/components/settings/provider-account-card";
import { ClaudeMark, OpenAIMark } from "@/components/settings/provider-logos";
import type { ProviderConnectionSnapshot } from "@/lib/providers/provider-connection-view";
import { providerRunsIn } from "@/lib/providers/provider-surface-capability";

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
 * One card per agent account, each stating where it runs. Shared by the
 * settings page and the workspace's settings dialog, so connecting from
 * either place looks and behaves the same.
 */
export function ProviderAccountList({
  snapshot,
  onChange,
  dialogClassName,
}: {
  snapshot: ProviderConnectionSnapshot;
  /** Reload the snapshot after a change; the settings page omits it. */
  onChange?: (() => void) | undefined;
  /** Surface class for confirmations portaled out of a themed subtree. */
  dialogClassName?: string | undefined;
}) {
  return (
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
            dialogClassName={dialogClassName}
            hostedClaudeConnect={
              snapshot.hostedClaudeConnect && card.connection === "anthropic"
            }
            hostedOpenAIConnect={
              snapshot.hostedOpenAIConnect && card.connection === "openai"
            }
            key={card.label}
            label={card.label}
            logo={card.logo}
            onChange={onChange}
            runsIn={providerRunsIn(snapshot, card.connection)}
            subscription={subscription}
          />
        );
      })}
    </div>
  );
}
