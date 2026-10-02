import { isGitHubAuthConfigured } from "@codev/config";
import { KeyRound, Mail } from "lucide-react";

import { connectGitHubAccount } from "@/app/actions/github";
import { GithubMark } from "@/components/settings/github-mark";
import { GoogleMark } from "@/components/settings/google-mark";
import { SettingsConnectionRow } from "@/components/settings/settings-connection-row";
import {
  SettingsPageHeader,
  SettingsPageShell,
} from "@/components/settings/settings-style";
import { SetPasswordForm } from "@/components/settings/set-password-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getConnectedAccounts } from "@/lib/auth/identity";
import { requireUser } from "@/lib/auth/session";

const passwordErrorCopy: Record<string, string> = {
  match: "Those passwords did not match. Try again.",
  policy: "Choose a stronger password that meets every requirement below.",
  exists: "This account already has a password set.",
};

function initials(
  name: string | null | undefined,
  email: string | null | undefined,
) {
  const source = name?.trim() || email?.trim() || "";
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export default async function PersonalProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string; password?: string; error?: string }>;
}) {
  const user = await requireUser();
  const connectedAccounts = await getConnectedAccounts(user.id);
  const params = await searchParams;
  const githubJustConnected =
    params.github === "connected" && connectedAccounts.github.connected;
  const passwordJustSet =
    params.password === "set" && connectedAccounts.hasPassword;
  const passwordError = params.error ? passwordErrorCopy[params.error] : null;

  return (
    <SettingsPageShell>
      <SettingsPageHeader
        description="The identity and sign-in methods connected to your CoDev account."
        title="Profile"
      />

      <Card className="flex flex-row items-center gap-4 p-4">
        <Avatar className="size-14">
          <AvatarFallback className="text-sm">
            {initials(user.name, user.email)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-base font-semibold">
            {user.name || "Unnamed"}
          </p>
          <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            <Mail aria-hidden className="size-3.5 shrink-0" />
            {user.email || "No email on file"}
          </p>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <CardHeader>
          <CardTitle>Sign-in methods</CardTitle>
          <CardDescription>
            Sign in with any of these, or link more.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {githubJustConnected ? (
            <Alert role="status">
              <AlertDescription>
                GitHub account connected to this CoDev account.
              </AlertDescription>
            </Alert>
          ) : null}
          <SettingsConnectionRow
            connected={connectedAccounts.google.connected}
            icon={<GoogleMark className="size-5" />}
            name="Google"
            statusText={
              connectedAccounts.google.connected ? "Connected" : "Not connected"
            }
          />
          <Separator />
          <SettingsConnectionRow
            action={
              !connectedAccounts.github.connected &&
              isGitHubAuthConfigured() ? (
                <form
                  action={connectGitHubAccount.bind(
                    null,
                    "/settings/personal/profile?github=connected",
                  )}
                >
                  <Button size="sm" type="submit" variant="outline">
                    Connect
                  </Button>
                </form>
              ) : undefined
            }
            connected={connectedAccounts.github.connected}
            icon={<GithubMark className="size-5" />}
            name="GitHub"
            statusText={
              connectedAccounts.github.connected
                ? connectedAccounts.github.login
                  ? `@${connectedAccounts.github.login}`
                  : "Connected"
                : "Not connected"
            }
          />
          <Separator />
          <SettingsConnectionRow
            connected={connectedAccounts.hasPassword}
            icon={<KeyRound aria-hidden className="size-4" />}
            name="Password"
            statusText={connectedAccounts.hasPassword ? "Set" : "Not set"}
          />
          {connectedAccounts.sameCoDevUser ? (
            <p className="text-sm text-muted-foreground" role="status">
              Google and GitHub are connected to this same CoDev account.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {connectedAccounts.hasPassword ? null : (
        <Card className="flex flex-col gap-4 p-4">
          <CardHeader>
            <CardTitle>Set a password</CardTitle>
            <CardDescription>
              You signed in with Google or GitHub, so this account has no
              password yet. Set one to also be able to sign in with your email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {passwordJustSet ? (
              <Alert role="status">
                <AlertDescription>
                  Password set. You can now sign in with your email too.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-col gap-3">
                {passwordError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{passwordError}</AlertDescription>
                  </Alert>
                ) : null}
                <SetPasswordForm redirectTo="/settings/personal/profile" />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </SettingsPageShell>
  );
}
