import "./settings-theme.css";

import { AppChrome } from "@/components/shell/app-chrome";
import { SettingsFeedbackProvider } from "@/components/settings/settings-feedback";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { requireUser } from "@/lib/auth/session";

export default async function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();

  return (
    <AppChrome sidebar user={user}>
      <div className="settings-scope flex min-h-full flex-col md:flex-row">
        <SettingsSidebar />
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6">
          <SettingsFeedbackProvider>
            <div className="w-full max-w-3xl">{children}</div>
          </SettingsFeedbackProvider>
        </main>
      </div>
    </AppChrome>
  );
}
