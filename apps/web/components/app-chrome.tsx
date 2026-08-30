import Image from "next/image";
import Link from "next/link";

import { isGitHubAuthConfigured } from "@codev/config";

import { AppSidebarNav } from "@/components/app-sidebar-nav";
import { FeedbackWidget } from "@/components/feedback-widget";
import { ProfileMenu } from "@/components/profile-menu";
import { isUserAdmin } from "@/lib/admin";
import { clerkAuthConfigured } from "@/lib/identity";

export function Brand() {
  return (
    <Link className="wordmark" href="/" aria-label="CoDev home">
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
  const showConnectGitHub = !user.githubLogin && isGitHubAuthConfigured();
  const useClerkAuth = clerkAuthConfigured();
  const showAdmin = user.id ? await isUserAdmin(user.id) : false;

  if (sidebar) {
    return (
      <div className="app-page app-with-sidebar">
        <aside className="app-sidebar">
          <div className="app-sidebar-header">
            <Brand />
          </div>
          <AppSidebarNav showAdmin={showAdmin} />
          <div className="app-sidebar-footer">
            <ProfileMenu
              user={user}
              showConnectGitHub={showConnectGitHub}
              useClerkAuth={useClerkAuth}
            />
          </div>
        </aside>
        <div className="app-sidebar-content">
          {children}
          <FeedbackWidget />
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      <header className="app-nav">
        <Brand />
        <nav aria-label="Application navigation">
          <Link href="/dashboard">Workspaces</Link>
        </nav>
        <div className="user-menu">
          <ProfileMenu
            user={user}
            showConnectGitHub={showConnectGitHub}
            useClerkAuth={useClerkAuth}
          />
        </div>
      </header>
      {children}
      <FeedbackWidget />
    </div>
  );
}
