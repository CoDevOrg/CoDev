import Image from "next/image";
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
    <a
      className="wordmark"
      href={publicAppHref("/", isAdminHost)}
      aria-label="CoDev home"
    >
      <Image
        className="brand-image"
        src="/brand/codev-mark.svg"
        alt=""
        width={28}
        height={28}
      />
      <span>CoDev</span>
    </a>
  );
}

type AppChromeUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
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
  // Pick fields: the session user also carries credential-derived data that
  // must not be serialized into a client component's props.
  const profile = {
    name: user.name,
    email: user.email,
    githubLogin: user.githubLogin,
    image: user.image,
  };

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
                user={profile}
                side="top"
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
          <a href={publicAppHref("/gen2", isAdminHost)}>Workspaces</a>
        </nav>
        <div className="user-menu">
          <ThemeToggle />
          <ProfileMenu
            user={profile}
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
