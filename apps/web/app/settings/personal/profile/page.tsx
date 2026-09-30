import { isGitHubAuthConfigured } from "@codev/config";
import { Download, KeyRound, Mail } from "lucide-react";

import { connectGitHubAccount } from "@/app/actions/github";
import { updateDisplayName } from "@/app/actions/profile";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GithubMark } from "@/components/settings/github-mark";
import { GoogleMark } from "@/components/settings/google-mark";
import {
  OrcaPageHeader,
  OrcaPageShell,
  OrcaSubsectionHeader,
} from "@/components/settings/orca-style";
import { SetPasswordForm } from "@/components/settings/set-password-form";
import { Card } from "@/components/ui/card";
import { getConnectedAccounts } from "@/lib/auth/identity";
import { requireUser } from "@/lib/auth/session";
import { cn } from "@/lib/platform/utils";

const passwordErrorCopy: Record<string, string> = {
  match: "Those passwords did not match. Try again.",
  policy: "Choose a stronger password that meets every requirement below.",
  exists: "This account already has a password set.",
  current: "That is not your current password.",
  nopassword: "This account has no password to change yet.",
};

// `error` is shared by the name and password forms; each shows only its own.
const PASSWORD_ERRORS = new Set([
  "match",
  "policy",
  "exists",
  "current",
  "nopassword",
]);

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

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        connected ? "bg-emerald-400" : "bg-muted-foreground/50",
      )}
    />
  );
}

function SignInMethodRow({
  icon,
  name,
  connected,
  statusText,
  action,
}: {
  icon: React.ReactNode;
  name: string;
  connected: boolean;
  statusText: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{name}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot connected={connected} />
            {statusText}
          </p>
        </div>
      </div>
      {action}
    </div>
  );
}

export default async function PersonalProfilePage({
  searchParams,
}: {
  searchParams: Promise<{
    github?: string;
    password?: string;
    name?: string;
    error?: string;
  }>;
}) {
  const user = await requireUser();
  const connectedAccounts = await getConnectedAccounts(user.id);
  const params = await searchParams;
  const githubJustConnected =
    params.github === "connected" && connectedAccounts.github.connected;
  const passwordJustSet =
    params.password === "set" && connectedAccounts.hasPassword;
  const passwordJustChanged =
    params.password === "changed" && connectedAccounts.hasPassword;
  const passwordError =
    params.error && PASSWORD_ERRORS.has(params.error)
      ? passwordErrorCopy[params.error]
      : null;
  const nameError =
    params.error === "name" ? "Enter a name up to 80 characters long." : null;

  return (
    <OrcaPageShell>
      <OrcaPageHeader
        description="The identity and sign-in methods connected to your CoDev account."
        title="Profile"
      />

      <Card className="space-y-4 px-6 py-5">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-foreground text-lg font-semibold text-background">
            {initials(user.name, user.email)}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-base font-semibold">
              {user.name || "Unnamed"}
            </p>
            <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              <Mail aria-hidden className="size-3.5 shrink-0" />
              {user.email || "No email on file"}
            </p>
          </div>
        </div>
        <form
          action={updateDisplayName}
          className="flex flex-wrap items-end gap-3 border-t border-border/60 pt-4"
        >
          <label className="block min-w-[14rem] flex-1 space-y-1.5 text-xs">
            <span className="font-medium text-muted-foreground">
              Display name
            </span>
            <Input
              autoComplete="name"
              defaultValue={user.name ?? ""}
              maxLength={80}
              name="name"
              required
            />
          </label>
          <Button size="sm" type="submit" variant="outline">
            Save name
          </Button>
          {params.name === "saved" ? (
            <p className="w-full text-xs text-emerald-400" role="status">
              Display name updated.
            </p>
          ) : null}
          {nameError ? (
            <p className="w-full text-xs text-red-400" role="alert">
              {nameError}
            </p>
          ) : null}
        </form>
      </Card>

      <Card className="space-y-4 px-6 py-5">
        <OrcaSubsectionHeader
          description="Sign in with any of these, or link more."
          title="Sign-in methods"
        />
        {githubJustConnected ? (
          <p className="text-xs text-emerald-400" role="status">
            GitHub account connected to this CoDev account.
          </p>
        ) : null}
        <div className="space-y-2">
          <SignInMethodRow
            connected={connectedAccounts.google.connected}
            icon={<GoogleMark className="size-5" />}
            name="Google"
            statusText={
              connectedAccounts.google.connected ? "Connected" : "Not connected"
            }
          />
          <SignInMethodRow
            action={
              connectedAccounts.github.connected ? (
                <LinkButton
                  href="/settings/personal/integrations"
                  size="sm"
                  variant="outline"
                >
                  Repository access
                </LinkButton>
              ) : isGitHubAuthConfigured() ? (
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
          <SignInMethodRow
            connected={connectedAccounts.hasPassword}
            icon={<KeyRound aria-hidden className="size-4" />}
            name="Password"
            statusText={connectedAccounts.hasPassword ? "Set" : "Not set"}
          />
        </div>
        {connectedAccounts.sameCoDevUser ? (
          <p className="text-xs text-muted-foreground" role="status">
            Google and GitHub are connected to this same CoDev account.
          </p>
        ) : null}
      </Card>

      {connectedAccounts.hasPassword ? (
        <Card className="space-y-4 px-6 py-5">
          <OrcaSubsectionHeader
            description="Enter your current password to choose a new one."
            title="Change password"
          />
          {passwordJustChanged ? (
            <p className="text-xs text-emerald-400" role="status">
              Password changed.
            </p>
          ) : null}
          {passwordError ? (
            <p className="text-xs text-red-400" role="alert">
              {passwordError}
            </p>
          ) : null}
          <SetPasswordForm
            mode="change"
            redirectTo="/settings/personal/profile"
          />
        </Card>
      ) : (
        <Card className="space-y-4 px-6 py-5">
          <OrcaSubsectionHeader
            description="You signed in with Google or GitHub, so this account has no password yet. Set one to also be able to sign in with your email."
            title="Set a password"
          />
          {passwordJustSet ? (
            <p className="text-xs text-emerald-400" role="status">
              Password set. You can now sign in with your email too.
            </p>
          ) : (
            <>
              {passwordError ? (
                <p className="text-xs text-red-400" role="alert">
                  {passwordError}
                </p>
              ) : null}
              <SetPasswordForm redirectTo="/settings/personal/profile" />
            </>
          )}
        </Card>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <OrcaSubsectionHeader
          description="A JSON copy of your profile, sign-in methods, and the names of your environment variables. Secrets are never included."
          title="Your data"
        />
        <LinkButton
          download
          href="/api/settings/export"
          size="sm"
          variant="outline"
        >
          <Download aria-hidden className="size-3.5" />
          Download account data
        </LinkButton>
      </Card>
    </OrcaPageShell>
  );
}
