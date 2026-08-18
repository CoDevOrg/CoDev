import "../orca-theme.css";

import { AppChrome } from "@/components/app-chrome";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { requireUser } from "@/lib/session";

export default async function PersonalSettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();

  return (
    <AppChrome user={user}>
      <div className="orca-settings-scope flex min-h-[calc(100vh-68px)]">
        <SettingsSidebar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </AppChrome>
  );
}
