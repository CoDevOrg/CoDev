import { isGitHubAuthConfigured } from "@codev/config";

import { connectGitHubAccount } from "@/app/actions/github";
import {
  OrcaCard,
  OrcaPageHeader,
  OrcaPageShell,
  OrcaSubsectionHeader,
} from "@/components/settings/orca-style";
import { getConnectedAccounts } from "@/lib/identity";
import { requireUser } from "@/lib/session";

export default async function PersonalProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string }>;
}) {
  const user = await requireUser();
  const connectedAccounts = await getConnectedAccounts(user.id);
  const params = await searchParams;
  const githubJustConnected =
    params.github === "connected" && connectedAccounts.github.connected;

  return (
    <OrcaPageShell>
      <OrcaPageHeader
        description="The identity and contact details connected to your CoDev account."
        title="Profile"
      />
      <OrcaCard className="space-y-3">
        <OrcaSubsectionHeader title="Profile" />
        {githubJustConnected ? (
          <p className="text-xs text-emerald-400" role="status">
            GitHub account connected to this CoDev account.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 text-xs">
          <div>
            <p className="text-muted-foreground">Display name</p>
            <p className="font-medium">{user.name || "Not set"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Email</p>
            <p className="font-medium">{user.email || "Not set"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Security</p>
            <p className="font-medium">Managed by your sign-in provider</p>
          </div>
        </div>
        <ul aria-label="Connected accounts" className="space-y-2">
          <li className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-xs">
            <span className="font-medium">Google</span>
            <span className="text-muted-foreground">
              {connectedAccounts.google.connected
                ? "Connected"
                : "Not connected"}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-xs">
            <span className="font-medium">GitHub</span>
            {connectedAccounts.github.connected ? (
              <span className="text-muted-foreground">
                {connectedAccounts.github.login
                  ? `@${connectedAccounts.github.login}`
                  : "Connected"}
              </span>
            ) : isGitHubAuthConfigured() ? (
              <form
                action={connectGitHubAccount.bind(
                  null,
                  "/settings/personal/profile?github=connected",
                )}
              >
                <button
                  className="text-xs font-medium underline underline-offset-2"
                  type="submit"
                >
                  Connect GitHub account
                </button>
              </form>
            ) : (
              <span className="text-muted-foreground">Not connected</span>
            )}
          </li>
        </ul>
        {connectedAccounts.sameCoDevUser ? (
          <p className="text-xs text-muted-foreground" role="status">
            Google and GitHub are connected to this same CoDev account.
          </p>
        ) : null}
      </OrcaCard>
    </OrcaPageShell>
  );
}
