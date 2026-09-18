import { AppChrome } from "@/components/shell/app-chrome";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { requireUser } from "@/lib/auth/session";

export default async function OrganizationSettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();

  return (
    <AppChrome user={user} sidebar>
      <div className="settings-layout">
        <SettingsSidebar />
        <main className="settings-layout-content">{children}</main>
      </div>
    </AppChrome>
  );
}
