import { BrowserSessionList } from "@/components/settings/browser-session-list";
import { CliLoginList } from "@/components/settings/cli-login-list";
import {
  SettingsPageHeader,
  SettingsPageShell,
} from "@/components/settings/settings-style";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { listCliAccessTokens } from "@/lib/auth/cli-access-tokens";
import { requireUser } from "@/lib/auth/session";
import { listUserSessions } from "@/lib/auth/user-sessions";

export const metadata = { title: "Sessions" };

export default async function PersonalSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ "signed-out"?: string }>;
}) {
  const user = await requireUser("/settings/personal/sessions");
  const [sessions, logins, params] = await Promise.all([
    listUserSessions(user.id),
    listCliAccessTokens(user.id),
    searchParams,
  ]);

  return (
    <SettingsPageShell>
      <SettingsPageHeader
        description="Everywhere your account is signed in. Sign out of anything you do not recognize, then change your password."
        title="Sessions"
      />
      {params["signed-out"] === "others" ? (
        <Alert role="status">
          <AlertDescription>
            Signed out every other session. This browser stays signed in.
          </AlertDescription>
        </Alert>
      ) : null}
      <Card className="flex flex-col gap-4 p-4">
        <CardHeader>
          <CardTitle>Browser sessions</CardTitle>
          <CardDescription>
            Signing a session out ends it on that device within seconds,
            including open terminals and workspace connections.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrowserSessionList
            currentSessionId={user.sessionId}
            sessions={sessions}
          />
        </CardContent>
      </Card>
      <Card className="flex flex-col gap-4 p-4">
        <CardHeader>
          <CardTitle>CLI and app logins</CardTitle>
          <CardDescription>
            The CoDev CLI and mobile app sign in with their own tokens, which
            last 90 days. Changing your password revokes all of them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CliLoginList logins={logins} />
        </CardContent>
      </Card>
    </SettingsPageShell>
  );
}
