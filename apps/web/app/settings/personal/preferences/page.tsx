import {
  SettingsPageHeader,
  SettingsPageShell,
} from "@/components/settings/settings-style";
import { ThemePreference } from "@/components/settings/theme-preference";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Preferences" };

/** Browser-local preferences: nothing here needs the server or the database. */
export default function PersonalPreferencesPage() {
  return (
    <SettingsPageShell>
      <SettingsPageHeader
        description="How CoDev looks in this browser."
        title="Preferences"
      />
      <Card className="flex flex-col gap-4 p-4">
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>
            System follows your device&apos;s light or dark setting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemePreference />
        </CardContent>
      </Card>
    </SettingsPageShell>
  );
}
