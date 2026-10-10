import { isGitHubAuthConfigured } from "@codev/config";
import { KeyRound } from "lucide-react";

import { connectGitHubAccount } from "@/app/actions/github";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { EmailPasswordLinkButton } from "@/components/settings/email-password-link-button";
import { GithubMark } from "@/components/settings/github-mark";
import { GoogleMark } from "@/components/settings/google-mark";
import { SecurityActivity } from "@/components/settings/security-activity";
import { SettingsConnectionRow } from "@/components/settings/settings-connection-row";
import {
  SettingsPageHeader,
  SettingsPageShell,
} from "@/components/settings/settings-style";
import { TwoFactorPanel } from "@/components/settings/two-factor-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getConnectedAccounts } from "@/lib/auth/identity";
import { listSecurityEvents } from "@/lib/auth/security-events";
import { requireUser } from "@/lib/auth/session";
import { getTwoFactorStatus } from "@/lib/auth/two-factor";

export const metadata = { title: "Security" };

export default async function PersonalSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string; password?: string }>;
}) {
  const user = await requireUser("/settings/personal/security");
  const [accounts, twoFactor, events, params] = await Promise.all([
    getConnectedAccounts(user.id),
    getTwoFactorStatus(user.id),
    listSecurityEvents(user.id, 15),
    searchParams,
  ]);

  return (
    <SettingsPageShell>
      <SettingsPageHeader
        description="Your password, two-factor authentication, and the ways you sign in. Security changes are emailed to you."
        title="Security"
      />

      <Card className="flex flex-col gap-4 p-4">
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            {accounts.hasPassword
              ? "Changing it signs you out everywhere except this browser, including CLI logins."
              : "You sign in with Google or GitHub. Add a password to also sign in with your email. We email you a secure link to create it."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {params.password === "changed" ? (
            <Alert role="status">
              <AlertDescription>
                Password changed. Your other sessions and CLI logins were signed
                out.
              </AlertDescription>
            </Alert>
          ) : null}
          {accounts.hasPassword ? (
            <ChangePasswordForm />
          ) : (
            <EmailPasswordLinkButton label="Email me a link to create a password" />
          )}
        </CardContent>
        {accounts.hasPassword ? (
          <CardFooter className="flex-wrap gap-x-3 gap-y-2 border-t border-border pt-4">
            <p className="m-0 text-sm text-muted-foreground">
              Forgot your current password?
            </p>
            <EmailPasswordLinkButton
              label="Email me a reset link"
              variant="ghost"
            />
          </CardFooter>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Two-factor authentication</CardTitle>
            <Badge variant={twoFactor.enabled ? "secondary" : "muted"}>
              {twoFactor.enabled ? "On" : "Off"}
            </Badge>
          </div>
          <CardDescription>
            Signing in also asks for a code from an authenticator app, whether
            you use a password, Google, or GitHub. Resetting a forgotten
            password needs the code too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorPanel
            enabled={twoFactor.enabled}
            hasPassword={accounts.hasPassword}
            recoveryCodesRemaining={twoFactor.recoveryCodesRemaining}
          />
        </CardContent>
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <CardHeader>
          <CardTitle>Sign-in methods</CardTitle>
          <CardDescription>
            Any of these signs in to this account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {params.github === "connected" && accounts.github.connected ? (
            <Alert role="status">
              <AlertDescription>
                GitHub is now connected to this account.
              </AlertDescription>
            </Alert>
          ) : null}
          {params.github === "two-factor" ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>
                That GitHub account belongs to another CoDev account with
                two-factor authentication, so it was not connected.
              </AlertDescription>
            </Alert>
          ) : null}
          <SettingsConnectionRow
            connected={accounts.google.connected}
            icon={<GoogleMark className="size-5" />}
            name="Google"
            statusText={
              accounts.google.connected ? "Connected" : "Not connected"
            }
          />
          <Separator />
          <SettingsConnectionRow
            action={
              !accounts.github.connected && isGitHubAuthConfigured() ? (
                <form
                  action={connectGitHubAccount.bind(
                    null,
                    "/settings/personal/security?github=connected",
                  )}
                >
                  <Button size="sm" type="submit" variant="outline">
                    Connect
                  </Button>
                </form>
              ) : undefined
            }
            connected={accounts.github.connected}
            icon={<GithubMark className="size-5" />}
            name="GitHub"
            statusText={
              accounts.github.connected
                ? accounts.github.login
                  ? `@${accounts.github.login}`
                  : "Connected"
                : "Not connected"
            }
          />
          <Separator />
          <SettingsConnectionRow
            connected={accounts.hasPassword}
            icon={<KeyRound aria-hidden className="size-4" />}
            name="Email and password"
            statusText={accounts.hasPassword ? "Set" : "Not set"}
          />
        </CardContent>
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <CardHeader>
          <CardTitle>Recent security activity</CardTitle>
          <CardDescription>
            Sign-ins and security changes from the last 180 days. Something you
            do not recognize? Change your password and sign out other sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SecurityActivity events={events} />
        </CardContent>
      </Card>
    </SettingsPageShell>
  );
}
