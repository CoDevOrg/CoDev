"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, KeyRound, Plug, Search, User } from "lucide-react";

import { cn } from "@/lib/utils";

type SettingsNavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  keywords?: string[];
};

const personalNav: SettingsNavItem[] = [
  { name: "Profile", href: "/settings/personal/profile", icon: User },
  {
    name: "AI Provider Accounts",
    href: "/settings/personal/providers",
    icon: Plug,
    badge: "Optional",
    keywords: ["openai", "anthropic", "api key", "codex", "claude"],
  },
  {
    name: "Environment Variables",
    href: "/settings/personal/environment",
    icon: KeyRound,
    keywords: ["env", ".env"],
  },
];

function matchesQuery(item: SettingsNavItem, query: string): boolean {
  if (!query) return true;
  const haystack = [item.name, ...(item.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function SettingsSidebar() {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const visibleNav = personalNav.filter((item) => matchesQuery(item, query));

  return (
    <aside className="orca-settings-scope flex w-[280px] shrink-0 flex-col border-r border-worktree-sidebar-border bg-worktree-sidebar">
      <div className="border-b border-worktree-sidebar-border px-3 py-3">
        <Link
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent/60 hover:text-worktree-sidebar-foreground"
          href="/dashboard"
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          Back to Dashboard
        </Link>
      </div>

      <div className="border-b border-worktree-sidebar-border px-3 py-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            aria-label="Search settings"
            className="h-9 w-full rounded-md border border-border bg-background/60 pl-9 pr-3 text-[13px] text-worktree-sidebar-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings"
            type="search"
            value={query}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-2">
          <p className="px-3 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Personal
          </p>
          {visibleNav.length > 0 ? (
            <nav aria-label="Personal settings" className="space-y-1">
              {visibleNav.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;

                return (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-worktree-sidebar-ring/50",
                      isActive
                        ? "bg-worktree-sidebar-accent font-medium text-worktree-sidebar-accent-foreground ring-1 ring-worktree-sidebar-ring/25"
                        : "text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-accent/60 hover:text-worktree-sidebar-foreground",
                    )}
                    href={item.href}
                    key={item.href}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="truncate">{item.name}</span>
                    {item.badge ? (
                      <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium tracking-wider text-muted-foreground uppercase">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          ) : (
            <p className="px-3 text-xs text-muted-foreground">
              No matching settings.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
