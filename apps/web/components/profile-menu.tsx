"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { connectGitHubAccount } from "@/app/actions/github";
import { signOutToHome } from "@/app/actions/auth";
import { ClerkSignOut } from "@/components/clerk-sign-out";

export type ProfileMenuUser = {
  name?: string | null | undefined;
  githubLogin?: string | undefined;
  image?: string | null | undefined;
};

export function ProfileMenu({
  user,
  compact = false,
  returnTo = "/dashboard",
  showConnectGitHub = false,
  useClerkAuth = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
}: {
  user: ProfileMenuUser;
  compact?: boolean;
  returnTo?: string;
  showConnectGitHub?: boolean;
  useClerkAuth?: boolean;
}) {
  const displayName = user.githubLogin ?? user.name ?? "Your account";
  const initial = displayName.slice(0, 1).toUpperCase();

  return (
    <details
      className={`profile-menu${compact ? " profile-menu-compact" : ""}`}
    >
      <summary
        className="profile-menu-trigger"
        aria-label={compact ? `Account menu for ${displayName}` : undefined}
      >
        {user.image ? (
          <Image
            src={user.image}
            alt=""
            width={compact ? 26 : 30}
            height={compact ? 26 : 30}
            unoptimized
          />
        ) : (
          <span className="user-fallback" aria-hidden="true">
            {initial}
          </span>
        )}
        {compact ? null : (
          <>
            <span className="profile-menu-name">{displayName}</span>
            <ChevronDown className="profile-menu-chevron" aria-hidden="true" />
          </>
        )}
      </summary>
      <div className="profile-menu-popover">
        <div className="profile-menu-heading">
          <span>Account</span>
          <strong>{user.name ?? user.githubLogin ?? "Your account"}</strong>
        </div>
        <Link className="profile-menu-link" href="/settings">
          Settings
        </Link>
        <Link className="profile-menu-link" href="/settings/personal/profile">
          Profile
        </Link>
        {showConnectGitHub ? (
          <form action={connectGitHubAccount.bind(null, returnTo)}>
            <button className="profile-menu-action" type="submit">
              Connect GitHub
            </button>
          </form>
        ) : null}
        <div className="profile-menu-divider" />
        {useClerkAuth ? (
          <ClerkSignOut />
        ) : (
          <form action={signOutToHome}>
            <button className="profile-menu-action" type="submit">
              Sign out
            </button>
          </form>
        )}
      </div>
    </details>
  );
}
