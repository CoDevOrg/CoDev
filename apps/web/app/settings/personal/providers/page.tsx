import { ProviderAccountList } from "@/components/settings/provider-account-list";
import {
  SettingsPageHeader,
  SettingsPageShell,
} from "@/components/settings/settings-style";
import { loadProviderConnectionSnapshot } from "@/lib/providers/provider-connection-server";
import { requireUser } from "@/lib/auth/session";

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
 * so the two cannot disagree. A login is only ever used by turns its owner
 * starts, so there is nothing left to ask about sharing it.
 */
export default async function PersonalProvidersPage() {
  const user = await requireUser();
  const snapshot = await loadProviderConnectionSnapshot(user);

  return (
    <SettingsPageShell>
      <SettingsPageHeader
        description="Agents you start run on your own accounts; other workspace members connect their own. Connect at least one to start agents in workspaces and rooms. Logins and keys are encrypted on the CoDev server and never shown again."
        title="AI Provider Accounts"
      />
      <ProviderAccountList snapshot={snapshot} />
    </SettingsPageShell>
  );
}
