import { isGitHubAuthConfigured } from "@codev/config";

import { connectGitHubAccount } from "@/app/actions/github";
import {
  SettingsPageHeader as SettingsSectionHeader,
  SettingsPageShell,
} from "@/components/settings/settings-style";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AppUser, ConnectedAccounts } from "@/lib/auth/identity";
import type { OrganizationSettingsContext } from "@/lib/auth/settings-access";
export function SettingsPageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="settings-page-header">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel settings-panel settings-card">
      <div className="settings-card-heading">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function SettingsPlaceholder({
  title,
  description,
  detail,
}: {
  title: string;
  description: string;
  detail: string;
}) {
  return (
    <SettingsCard description={description} title={title}>
      <div className="settings-placeholder">
        <span aria-hidden="true" className="settings-placeholder-mark">
          •
        </span>
        <strong>Ready for setup</strong>
        <p>{detail}</p>
      </div>
    </SettingsCard>
  );
}

export function ProfileSettings({
  user,
  githubStatus,
  connectedAccounts,
}: {
  user: AppUser;
  githubStatus: "connected" | undefined;
  connectedAccounts: ConnectedAccounts;
}) {
  return (
    <>
      {githubStatus === "connected" ? (
        <div className="settings-status-banner" role="status">
          GitHub account connected to this CoDev account.
        </div>
      ) : null}
      <SettingsCard
        description="The identity and contact details connected to your CoDev account."
        title="Profile"
      >
        <div className="settings-profile-grid">
          <div>
            <span className="settings-field-label">Display name</span>
            <strong>{user.name ?? "Not set"}</strong>
          </div>
          <div>
            <span className="settings-field-label">Email</span>
            <strong>{user.email ?? "Not set"}</strong>
          </div>
          <div>
            <span className="settings-field-label">GitHub handle</span>
            {connectedAccounts.github.connected ? (
              <strong>
                {connectedAccounts.github.login
                  ? `@${connectedAccounts.github.login}`
                  : "Connected"}
              </strong>
            ) : (
              <>
                <strong>Not connected</strong>
                {isGitHubAuthConfigured() ? (
                  <form
                    action={connectGitHubAccount.bind(
                      null,
                      "/settings/personal/profile?github=connected",
                    )}
                  >
                    <button
                      className="secondary-button settings-connect-button"
                      type="submit"
                    >
                      Connect GitHub account
                    </button>
                  </form>
                ) : null}
              </>
            )}
          </div>
          <div>
            <span className="settings-field-label">Security</span>
            <strong>Managed by your sign-in provider</strong>
          </div>
        </div>
      </SettingsCard>
      <SettingsCard
        description="These provider identities are linked to your single CoDev profile."
        title="Connected accounts"
      >
        <div className="settings-connected-accounts">
          <div className="settings-connected-account">
            <div>
              <span className="settings-field-label">Google</span>
              <strong>
                {connectedAccounts.google.connected
                  ? "Connected"
                  : "Not connected"}
              </strong>
            </div>
            <span
              className={`settings-connection-status ${connectedAccounts.google.connected ? "is-connected" : ""}`}
            >
              {connectedAccounts.google.connected ? "Active" : "—"}
            </span>
          </div>
          <div className="settings-connected-account">
            <div>
              <span className="settings-field-label">GitHub</span>
              <strong>
                {connectedAccounts.github.connected
                  ? connectedAccounts.github.login
                    ? `@${connectedAccounts.github.login}`
                    : "Connected"
                  : "Not connected"}
              </strong>
            </div>
            <span
              className={`settings-connection-status ${connectedAccounts.github.connected ? "is-connected" : ""}`}
            >
              {connectedAccounts.github.connected ? "Active" : "—"}
            </span>
          </div>
        </div>
        {connectedAccounts.sameCoDevUser ? (
          <p className="settings-account-match" role="status">
            Google and GitHub are connected to this same CoDev account.
          </p>
        ) : null}
      </SettingsCard>
    </>
  );
}

export function OrganizationSettingsPage({
  context,
  title,
  description,
  children,
}: {
  context: OrganizationSettingsContext | null;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  if (!context) {
    return (
      <SettingsPageShell>
        <SettingsSectionHeader description={description} title={title} />
        <Card className="flex flex-col gap-3 p-4">
          <CardHeader>
            <CardTitle>No organization selected</CardTitle>
            <CardDescription>
              Join or create an organization before configuring shared settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Organization settings become available when you belong to an
              organization.
            </p>
          </CardContent>
        </Card>
      </SettingsPageShell>
    );
  }

  const roleLabel = context.role.replaceAll("_", " ");

  return (
    <SettingsPageShell>
      <SettingsSectionHeader
        badge={roleLabel}
        description={`${context.workspace.repository}. ${description}`}
        title={title}
      />
      <p className="text-sm text-muted-foreground">
        {context.canWrite
          ? "You can manage shared organization settings."
          : "Read-only access for this organization."}
      </p>
      {!context.canWrite ? (
        <Alert role="status">
          <AlertTitle>Read-only view</AlertTitle>
          <AlertDescription>
            Only organization owners and admins can change shared settings.
          </AlertDescription>
        </Alert>
      ) : null}
      {children}
    </SettingsPageShell>
  );
}

export function OrganizationSettingsCard({
  context,
  title,
  description,
  detail,
}: {
  context: OrganizationSettingsContext | null;
  title: string;
  description: string;
  detail: string;
}) {
  return (
    <Card className="flex flex-col gap-4 p-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">
            {context?.canWrite ? "Managed resource" : "Resource summary"}
          </p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
        <Badge variant="outline">
          {context?.canWrite ? "Admin access" : "Read only"}
        </Badge>
      </CardContent>
    </Card>
  );
}
