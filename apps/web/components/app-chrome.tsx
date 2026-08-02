import Image from "next/image";
import Link from "next/link";

import { isGitHubAuthConfigured } from "@codev/config";

import { signIn, signOut } from "@/auth";
import { ClerkSignOut } from "@/components/clerk-sign-out";
import { ThemeToggle } from "@/components/theme-toggle";
import { clerkAuthConfigured } from "@/lib/identity";
import { isPilotAdminLogin } from "@/lib/pilot-access";

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

export function AppChrome({
  user,
  children,
}: {
  user: { name?: string | null; githubLogin?: string; image?: string | null };
  children: React.ReactNode;
}) {
  return (
    <div className="app-page">
      <header className="app-nav">
        <Brand />
        <nav aria-label="Application navigation">
          <Link href="/dashboard">Workspaces</Link>
          {isPilotAdminLogin(user.githubLogin) ? (
            <Link href="/pilot">Pilot</Link>
          ) : null}
        </nav>
        <div className="user-menu">
          <details className="profile-menu">
            <summary className="profile-menu-trigger">
              {user.image ? (
                <Image
                  src={user.image}
                  alt=""
                  width={30}
                  height={30}
                  unoptimized
                />
              ) : (
                <span className="user-fallback" aria-hidden="true">
                  {(user.githubLogin ?? user.name ?? "U")
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
              )}
              <span className="profile-menu-name">
                {user.githubLogin ?? user.name ?? "Your account"}
              </span>
              <span className="profile-menu-chevron" aria-hidden="true">
                ⌄
              </span>
            </summary>
            <div className="profile-menu-popover">
              <div className="profile-menu-heading">
                <span>Account</span>
                <strong>
                  {user.name ?? user.githubLogin ?? "Your account"}
                </strong>
              </div>
              <Link
                className="profile-menu-link"
                href="/settings/personal/profile"
              >
                Profile
              </Link>
              <Link className="profile-menu-link" href="/settings">
                Settings
              </Link>
              <div className="profile-menu-divider" />
              <ThemeToggle />
              {!user.githubLogin && isGitHubAuthConfigured() ? (
                <form
                  action={async () => {
                    "use server";
                    await signIn("github", { redirectTo: "/dashboard" });
                  }}
                >
                  <button className="profile-menu-action" type="submit">
                    Connect GitHub
                  </button>
                </form>
              ) : null}
              {clerkAuthConfigured() ? (
                <ClerkSignOut />
              ) : (
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/" });
                  }}
                >
                  <button className="profile-menu-action" type="submit">
                    Sign out
                  </button>
                </form>
              )}
            </div>
          </details>
        </div>
      </header>
      {children}
    </div>
  );
}
