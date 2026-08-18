"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, KeyRound, Plug, Search, User } from "lucide-react";

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

function SettingsNavGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: SettingsNavItem[];
  pathname: string | null;
}) {
  if (items.length === 0) return null;

  return (
    <div className="settings-sidebar-group">
      <h2 className="settings-sidebar-label">{label}</h2>
      <nav aria-label={`${label} settings`} className="settings-sidebar-nav">
        {items.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={`settings-sidebar-link ${
                isActive ? "settings-sidebar-link-active" : ""
              }`}
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden="true" className="settings-sidebar-icon" />
              <span>{item.name}</span>
              {item.badge ? (
                <span className="settings-sidebar-badge">{item.badge}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function SettingsSidebar() {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const visibleNav = personalNav.filter((item) => matchesQuery(item, query));

  return (
    <aside aria-label="Settings navigation" className="settings-sidebar">
      <Link className="settings-sidebar-back" href="/dashboard">
        <ArrowLeft aria-hidden="true" className="settings-sidebar-icon" />
        <span>Back to Dashboard</span>
      </Link>

      <div className="settings-sidebar-search">
        <Search aria-hidden="true" className="settings-sidebar-search-icon" />
        <input
          aria-label="Search settings"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings"
          type="search"
          value={query}
        />
      </div>

      {visibleNav.length > 0 ? (
        <SettingsNavGroup
          items={visibleNav}
          label="Personal"
          pathname={pathname}
        />
      ) : (
        <p className="settings-sidebar-empty">No matching settings.</p>
      )}
    </aside>
  );
}
