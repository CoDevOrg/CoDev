import "../orca-theme.css";

import { AppChrome } from "@/components/shell/app-chrome";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { requireUser } from "@/lib/auth/session";

export default async function PersonalSettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();

  return (
    <AppChrome user={user} sidebar>
      <div className="orca-settings-scope flex min-h-dvh">
        <SettingsSidebar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </AppChrome>
  );
}
