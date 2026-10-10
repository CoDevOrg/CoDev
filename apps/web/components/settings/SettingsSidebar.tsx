"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Blocks,
  CreditCard,
  KeyRound,
  MonitorSmartphone,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  User,
} from "lucide-react";

import { LinkButton } from "@/components/ui/button";
import { cn } from "@/lib/platform/utils";

type SettingsNavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
};

type SettingsNavGroup = { label: string; items: SettingsNavItem[] };

// Grouped by what the member is trying to do rather than by page: who they
// are, what runs their agents, and what those agents can reach.
const navGroups: SettingsNavGroup[] = [
  {
    label: "Account",
    items: [
      { name: "Profile", href: "/settings/personal/profile", icon: User },
      {
        name: "Security",
        href: "/settings/personal/security",
        icon: ShieldCheck,
      },
      {
        name: "Sessions",
        href: "/settings/personal/sessions",
        icon: MonitorSmartphone,
      },
      {
        name: "Preferences",
        href: "/settings/personal/preferences",
        icon: SlidersHorizontal,
      },
      {
        name: "Billing",
        href: "/settings/personal/billing",
        icon: CreditCard,
      },
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
    // Pinned to the page's scroll area on wide screens so the nav stays put
    // while a long page scrolls.
    <aside className="flex w-full shrink-0 flex-col gap-3 border-b border-border px-3 py-3 md:sticky md:top-0 md:h-dvh md:w-56 md:self-start md:overflow-y-auto md:border-r md:border-b-0">
      {/* Leaves room for the app sidebar's floating show button. */}
      <LinkButton
        className="w-fit [.is-sidebar-collapsed_&]:md:ml-9"
        href="/gen2"
        size="sm"
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
        Back to Dashboard
      </LinkButton>
      <nav aria-label="Settings" className="flex flex-col gap-4">
        {navGroups.map((group) => (
          <div className="flex flex-col gap-0.5" key={group.label}>
            <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {group.label}
            </p>
            {group.items.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
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
          </div>
        ))}
      </nav>
    </aside>
  );
}
