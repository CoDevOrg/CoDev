"use client";

import { useRef } from "react";
import Image from "next/image";
import {
  ChevronDown,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Settings,
} from "lucide-react";

import { connectGitHubAccount } from "@/app/actions/github";
import { signOutToHome } from "@/app/actions/auth";
import { GithubMark } from "@/components/settings/github-mark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { publicAppHref } from "@/lib/platform/site-hosts";

export type ProfileMenuUser = {
  name?: string | null | undefined;
  email?: string | null | undefined;
  githubLogin?: string | undefined;
  image?: string | null | undefined;
};

/**
 * The signed-in member's account menu. It is portaled, so the sidebar's scroll
 * container cannot clip it; `side="top"` opens it above the sidebar footer and
 * flips below the trigger when there is no room (the mobile top bar).
 *
 * The forms stay outside the portal: a menu item closes the menu, which would
 * unmount a form inside it before the browser submitted it.
 */
export function ProfileMenu({
  user,
  compact = false,
  side = "bottom",
  returnTo = "/gen2",
  showConnectGitHub = false,
  isAdminHost = false,
}: {
  user: ProfileMenuUser;
  compact?: boolean;
  side?: "top" | "bottom";
  returnTo?: string;
  showConnectGitHub?: boolean;
  isAdminHost?: boolean;
}) {
  const signOutForm = useRef<HTMLFormElement>(null);
  const connectForm = useRef<HTMLFormElement>(null);
  const displayName = user.name ?? user.githubLogin ?? "Your account";
  const secondary =
    user.email ?? (user.githubLogin ? `@${user.githubLogin}` : null);
  const Chevron = side === "top" ? ChevronsUpDown : ChevronDown;

  return (
    <div className={`profile-menu${compact ? " profile-menu-compact" : ""}`}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className="profile-menu-trigger"
          aria-label={`Account menu for ${displayName}`}
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
              {displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          {compact ? null : (
            <>
              <span className="profile-menu-name">{displayName}</span>
              <Chevron className="profile-menu-chevron" aria-hidden="true" />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="profile-menu-content"
          side={side}
          align={side === "top" ? "start" : "end"}
          sideOffset={8}
          collisionPadding={12}
        >
          <div className="profile-menu-heading">
            <strong>{displayName}</strong>
            {secondary ? <span>{secondary}</span> : null}
          </div>
          <DropdownMenuSeparator className="profile-menu-divider" />
          <DropdownMenuItem asChild className="profile-menu-item">
            <a href={publicAppHref("/settings", isAdminHost)}>
              <Settings aria-hidden="true" /> Settings
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="profile-menu-item">
            <a href={publicAppHref("/settings/personal/billing", isAdminHost)}>
              <CreditCard aria-hidden="true" /> Billing
            </a>
          </DropdownMenuItem>
          {showConnectGitHub ? (
            <DropdownMenuItem
              className="profile-menu-item"
              onSelect={() => connectForm.current?.requestSubmit()}
            >
              <GithubMark /> Connect GitHub
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator className="profile-menu-divider" />
          <DropdownMenuItem
            className="profile-menu-item"
            onSelect={() => signOutForm.current?.requestSubmit()}
          >
            <LogOut aria-hidden="true" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form ref={signOutForm} action={signOutToHome} hidden />
      {showConnectGitHub ? (
        <form
          ref={connectForm}
          action={connectGitHubAccount.bind(null, returnTo)}
          hidden
        />
      ) : null}
    </div>
  );
}
