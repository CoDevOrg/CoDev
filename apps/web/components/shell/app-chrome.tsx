import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";

import { isGitHubAuthConfigured } from "@codev/config";

import { AppSidebarFrame } from "@/components/shell/app-sidebar-frame";
import { AppSidebarNav } from "@/components/shell/app-sidebar-nav";
import { FeedbackWidget } from "@/components/shell/feedback-widget";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { isUserAdmin } from "@/lib/admin/admin";
import { isAdminHostname, publicAppHref } from "@/lib/platform/site-hosts";

export function Brand({ isAdminHost = false }: { isAdminHost?: boolean }) {
  return (
    <Link
      className="wordmark"
      href={publicAppHref("/", isAdminHost)}
      aria-label="CoDev home"
    >
      <Image
        className="brand-image"
        src="/brand/codev-mark-v3.png"
        alt=""
        width={28}
        height={28}
      />
      <span>CoDev</span>
    </Link>
  );
}

type AppChromeUser = {
  id?: string;
  name?: string | null;
  githubLogin?: string;
  image?: string | null;
};

export async function AppChrome({
  user,
  children,
  sidebar = false,
}: {
  user: AppChromeUser;
  children: React.ReactNode;
  sidebar?: boolean;
}) {
  const requestHeaders = await headers();
  const isAdminHost = isAdminHostname(requestHeaders.get("host"));
  const showConnectGitHub = !user.githubLogin && isGitHubAuthConfigured();
  const showAdmin = user.id ? await isUserAdmin(user.id) : false;

  if (sidebar) {
    return (
      <AppSidebarFrame
        sidebar={
          <aside className="app-sidebar" id="app-sidebar">
            <div className="app-sidebar-header">
              <Brand isAdminHost={isAdminHost} />
            </div>
            <AppSidebarNav showAdmin={showAdmin} isAdminHost={isAdminHost} />
            <div className="app-sidebar-footer">
              <ThemeToggle compact />
              <ProfileMenu
                user={user}
                showConnectGitHub={showConnectGitHub}
                isAdminHost={isAdminHost}
              />
            </div>
          </aside>
        }
      >
        {children}
        <FeedbackWidget />
      </AppSidebarFrame>
    );
  }

  return (
    <div className="app-page">
      <header className="app-nav">
        <Brand isAdminHost={isAdminHost} />
        <nav aria-label="Application navigation">
          <Link href={publicAppHref("/gen2", isAdminHost)}>Workspaces</Link>
        </nav>
        <div className="user-menu">
          <ThemeToggle />
          <ProfileMenu
            user={user}
            showConnectGitHub={showConnectGitHub}
            isAdminHost={isAdminHost}
          />
        </div>
      </header>
      {children}
      <FeedbackWidget />
    </div>
  );
}
