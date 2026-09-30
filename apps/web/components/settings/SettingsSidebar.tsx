"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Blocks, KeyRound, Plug, User } from "lucide-react";

import { cn } from "@/lib/platform/utils";

type SettingsNavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
};

type SettingsNavGroup = { label: string; items: SettingsNavItem[] };

// Grouped by what the member is trying to do, not by page count: who they are,
// what runs their agents, and what those agents can reach.
const navGroups: SettingsNavGroup[] = [
  {
    label: "Account",
    items: [
      { name: "Profile", href: "/settings/personal/profile", icon: User },
    ],
  },
  {
    label: "Agents",
    items: [
      {
        name: "AI Provider Accounts",
        href: "/settings/personal/providers",
        icon: Plug,
      },
      {
        name: "Environment Variables",
        href: "/settings/personal/environment",
        icon: KeyRound,
      },
    ],
  },
  {
    label: "Connections",
    items: [
      {
        name: "Integrations",
        href: "/settings/personal/integrations",
        icon: Blocks,
      },
    ],
  },
];

export function SettingsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="orca-settings-scope sticky top-0 flex h-dvh w-[280px] shrink-0 flex-col self-start border-r border-worktree-sidebar-border bg-worktree-sidebar">
      {/* Leaves room for the app sidebar's floating show button. */}
      <div className="border-b border-worktree-sidebar-border px-3 py-3 [.is-sidebar-collapsed_&]:pl-12">
        <Link
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent/60 hover:text-worktree-sidebar-foreground"
          href="/dashboard"
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          Back to Dashboard
        </Link>
      </div>

      <nav
        aria-label="Settings"
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4"
      >
        {navGroups.map((group) => (
          <div className="space-y-1" key={group.label}>
            <p className="px-3 pb-1 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {group.label}
            </p>
            {group.items.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 w-full items-center gap-2 rounded-lg border-l-2 border-transparent py-1.5 pr-3 pl-[10px] text-left text-[13px] transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-primary/50",
                    // A neutral wash plus a thin accent rule on the left,
                    // not a color wash -- carries "selected" through a
                    // precise mark instead of a blue block.
                    isActive
                      ? "border-primary bg-foreground/5 font-medium text-foreground"
                      : "text-worktree-sidebar-foreground/60 hover:bg-primary/5 hover:text-worktree-sidebar-foreground",
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="truncate">{item.name}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
