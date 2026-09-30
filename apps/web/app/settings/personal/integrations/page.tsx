import { Settings } from "lucide-react";

import { isGitHubAuthConfigured } from "@codev/config";

import { LinkButton } from "@/components/ui/button";
import { GithubMark } from "@/components/settings/github-mark";
import {
  IntegrationsList,
  type IntegrationRow,
} from "@/components/settings/integrations-list";
import {
  OrcaPageHeader,
  OrcaPageShell,
} from "@/components/settings/orca-style";
import { getConnectedAccounts } from "@/lib/auth/identity";
import { requireUser } from "@/lib/auth/session";

/**
 * GitHub is linked once, as a sign-in method on Profile. This page owns what
 * happens after that — which repositories the CoDev GitHub App can reach — so
 * it links back to Profile instead of offering a second "Connect" button that
 * did the same thing.
 */
export default async function PersonalIntegrationsPage() {
  const user = await requireUser();
  const connectedAccounts = await getConnectedAccounts(user.id);
  const github = connectedAccounts.github;

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
        : "Not linked. Link your GitHub sign-in on Profile first.",
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
            Manage repository access
          </LinkButton>
        ) : (
          <LinkButton
            href="/settings/personal/profile"
            size="sm"
            variant="outline"
          >
            Link on Profile
          </LinkButton>
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
