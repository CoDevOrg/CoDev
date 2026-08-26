import { Settings } from "lucide-react";

import { isGitHubAuthConfigured } from "@codev/config";

import { connectGitHubAccount } from "@/app/actions/github";
import { Button, LinkButton } from "@/components/ui/button";
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
  const installUrl = process.env.GITHUB_APP_SLUG
    ? `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new`
    : "https://github.com/settings/installations";

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
        github.connected ? (
          <LinkButton
            href={installUrl}
            rel="noreferrer"
            size="sm"
            target="_blank"
            variant="outline"
          >
            <Settings aria-hidden className="size-3.5" />
            Configure
          </LinkButton>
        ) : (
          <form action={connectAction}>
            <Button size="sm" type="submit">
              Connect
            </Button>
          </form>
        )
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
