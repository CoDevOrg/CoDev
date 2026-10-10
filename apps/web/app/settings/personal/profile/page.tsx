import { Mail } from "lucide-react";

import { updateDisplayName } from "@/app/actions/profile";
import {
  SettingsPageHeader,
  SettingsPageShell,
} from "@/components/settings/settings-style";
import { DeleteAccountPanel } from "@/components/settings/delete-account-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Profile" };

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

/** Reads only the session: no database round trip before the page shows. */
export default async function PersonalProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; error?: string }>;
}) {
  const [user, params] = await Promise.all([
    requireUser("/settings/personal/profile"),
    searchParams,
  ]);

  return (
    <SettingsPageShell>
      <SettingsPageHeader
        description="How you appear to teammates in workspaces, rooms, and shared chats."
        title="Profile"
      />

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-4">
          <Avatar className="size-14">
            {user.image ? <AvatarImage alt="" src={user.image} /> : null}
            <AvatarFallback className="text-sm">
              {initials(user.name, user.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="m-0 truncate text-base font-semibold">
              {user.name || "Unnamed"}
            </p>
            <p className="m-0 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              <Mail aria-hidden className="size-3.5 shrink-0" />
              {user.email || "No email on file"}
            </p>
          </div>
        </div>
        <Separator />
        <form
          action={updateDisplayName}
          className="flex flex-wrap items-end gap-3"
        >
          <Field className="min-w-[14rem] flex-1">
            <FieldLabel htmlFor="display-name">Display name</FieldLabel>
            <Input
              autoComplete="name"
              defaultValue={user.name ?? ""}
              id="display-name"
              maxLength={80}
              name="name"
              required
            />
          </Field>
          <Button size="sm" type="submit" variant="outline">
            Save name
          </Button>
        </form>
        {params.name === "saved" ? (
          <Alert role="status">
            <AlertDescription>Display name updated.</AlertDescription>
          </Alert>
        ) : null}
        {params.error === "name" ? (
          <Alert variant="destructive">
            <AlertDescription>
              Enter a name up to 80 characters long.
            </AlertDescription>
          </Alert>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>
            Your sign-in email. Password links and security alerts go here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field className="max-w-sm">
            <FieldLabel htmlFor="account-email">Email address</FieldLabel>
            <Input
              disabled
              id="account-email"
              readOnly
              value={user.email ?? ""}
            />
            <FieldDescription>
              It comes from how you signed up. To use a different address,
              contact admins@trycodev.com.
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <DeleteAccountPanel />
    </SettingsPageShell>
  );
}
