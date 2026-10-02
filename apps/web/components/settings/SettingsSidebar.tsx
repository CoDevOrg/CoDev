"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Blocks,
  CreditCard,
  Plug,
  Search,
  User,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { LinkButton } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/platform/utils";

type SettingsNavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  keywords?: string[];
};

const personalNav: SettingsNavItem[] = [
  { name: "Profile", href: "/settings/personal/profile", icon: User },
  {
    name: "Billing",
    href: "/settings/personal/billing",
    icon: CreditCard,
    keywords: ["stripe", "plan", "subscription", "payment"],
  },
  {
    name: "AI Provider Accounts",
    href: "/settings/personal/providers",
    icon: Plug,
    keywords: [
      "openai",
      "anthropic",
      "api key",
      "codex",
      "claude",
      "cursor",
      "connect",
      "sign in",
    ],
  },
  {
    name: "Integrations",
    href: "/settings/personal/integrations",
    icon: Blocks,
    keywords: ["github", "gitlab", "linear", "jira"],
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
    <aside className="flex w-full shrink-0 flex-col gap-3 border-b border-border px-3 py-3 md:w-56 md:border-r md:border-b-0">
      <LinkButton className="w-fit" href="/gen2" size="sm" variant="ghost">
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
        Back to Dashboard
      </LinkButton>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search settings"
          className="h-8 pl-8"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings"
          type="search"
          value={query}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Personal
        </p>
        {visibleNav.length > 0 ? (
          <nav aria-label="Personal settings" className="flex flex-col gap-0.5">
            {visibleNav.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    isActive
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">{item.name}</span>
                </Link>
              );
            })}
          </nav>
        ) : (
          <Empty className="px-2 py-3">
            <EmptyHeader>
              <EmptyTitle>No matching settings.</EmptyTitle>
              <EmptyDescription>
                Try a provider, integration, or account name.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </aside>
  );
}
