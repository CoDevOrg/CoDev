import { Settings } from "lucide-react";

import { isGitHubAuthConfigured } from "@codev/config";

import { connectGitHubAccount } from "@/app/actions/github";
import { Button } from "@/components/ui/button";
import { GithubMark } from "@/components/settings/github-mark";
import {
  IntegrationsList,
  type IntegrationRow,
} from "@/components/settings/integrations-list";
import {
  OrcaPageHeader,
  OrcaPageShell,
} from "@/components/settings/orca-style";
import { getConnectedAccounts } from "@/lib/identity";
import { requireUser } from "@/lib/session";

export default async function PersonalIntegrationsPage() {
  const user = await requireUser();
  const connectedAccounts = await getConnectedAccounts(user.id);
  const github = connectedAccounts.github;

  const connectAction = connectGitHubAccount.bind(
    null,
    "/settings/personal/integrations",
  );

  const rows: IntegrationRow[] = [
    {
      id: "github",
      name: "GitHub",
      icon: <GithubMark className="size-5" />,
      connected: github.connected,
      statusText: github.connected
        ? github.login
          ? `Connected · @${github.login}`
          : "Connected"
        : "Not connected",
      action: isGitHubAuthConfigured() ? (
        <form action={connectAction}>
          <Button
            size="sm"
            type="submit"
            variant={github.connected ? "outline" : "default"}
          >
            {github.connected ? (
              <>
                <Settings aria-hidden className="size-3.5" />
                Configure
              </>
            ) : (
              "Connect"
            )}
          </Button>
        </form>
      ) : null,
    },
  ];

  return (
    <OrcaPageShell>
      <OrcaPageHeader
        description="Connect the source hosts and task trackers CoDev can use for pull requests, checks, and linked task context."
        title="Integrations"
      />
      <IntegrationsList rows={rows} />
    </OrcaPageShell>
  );
}
