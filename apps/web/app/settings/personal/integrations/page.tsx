import { isGitHubAuthConfigured } from "@codev/config";

import { connectGitHubAccount } from "@/app/actions/github";
import { Button } from "@/components/ui/button";
import {
  OrcaCard,
  OrcaPageHeader,
  OrcaPageShell,
  OrcaSubsectionHeader,
} from "@/components/settings/orca-style";
import { getConnectedAccounts } from "@/lib/identity";
import { requireUser } from "@/lib/session";

export default async function PersonalIntegrationsPage() {
  const user = await requireUser();
  const connectedAccounts = await getConnectedAccounts(user.id);

  return (
    <OrcaPageShell>
      <OrcaPageHeader
        description="Connect the source hosts and task trackers CoDev can use for pull requests, checks, and linked task context."
        title="Integrations"
      />
      <OrcaCard className="space-y-3">
        <OrcaSubsectionHeader
          description="CoDev uses your GitHub connection to clone repositories, open pull requests, and surface review status."
          title="Source control"
        />
        <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium">GitHub</p>
            <p className="text-xs text-muted-foreground">
              {connectedAccounts.github.connected
                ? connectedAccounts.github.login
                  ? `Connected · @${connectedAccounts.github.login}`
                  : "Connected"
                : "Not connected"}
            </p>
          </div>
          {!connectedAccounts.github.connected && isGitHubAuthConfigured() ? (
            <form
              action={connectGitHubAccount.bind(
                null,
                "/settings/personal/integrations",
              )}
            >
              <Button size="sm" type="submit">
                Connect GitHub
              </Button>
            </form>
          ) : null}
        </div>
      </OrcaCard>
    </OrcaPageShell>
  );
}
