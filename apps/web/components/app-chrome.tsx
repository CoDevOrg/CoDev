import Image from "next/image";
import Link from "next/link";

import { signOut } from "@/auth";
import { isPilotAdminLogin } from "@/lib/pilot-access";

export function Brand() {
  return (
    <Link className="wordmark" href="/" aria-label="CoDev home">
      <span className="wordmark-mark" aria-hidden="true">
        <span />
        <span />
      </span>
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
          <Link href="/settings">Settings</Link>
        </nav>
        <div className="user-menu">
          {user.image ? (
            <Image src={user.image} alt="" width={28} height={28} unoptimized />
          ) : (
            <span className="user-fallback" aria-hidden="true">
              {(user.githubLogin ?? user.name ?? "U").slice(0, 1).toUpperCase()}
            </span>
          )}
          <span>{user.githubLogin ?? user.name ?? "GitHub user"}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="quiet-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
