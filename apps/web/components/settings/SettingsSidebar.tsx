"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Bot,
  CreditCard,
  Key,
  Plug,
  Settings,
  ShieldAlert,
  Sliders,
  User,
  Users,
} from "lucide-react";

type SettingsNavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
};

const personalNav: SettingsNavItem[] = [
  { name: "Profile", href: "/settings/personal/profile", icon: User },
  {
    name: "Coding Agents",
    href: "/settings/personal/agents",
    icon: Bot,
  },
  {
    name: "Integrations",
    href: "/settings/personal/integrations",
    icon: Plug,
  },
  { name: "API Keys", href: "/settings/personal/api-keys", icon: Key },
  {
    name: "Preferences",
    href: "/settings/personal/preferences",
    icon: Sliders,
  },
];

const organizationNav: SettingsNavItem[] = [
  { name: "Coding Agents", href: "/settings/org/agents", icon: Bot },
  { name: "Integrations", href: "/settings/org/integrations", icon: Plug },
  { name: "Settings", href: "/settings/org/general", icon: Settings },
  { name: "Billing", href: "/settings/org/billing", icon: CreditCard },
  { name: "Members", href: "/settings/org/members", icon: Users },
  {
    name: "Audit Log",
    href: "/settings/org/audit-log",
    icon: ShieldAlert,
  },
];

function SettingsNavGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: SettingsNavItem[];
  pathname: string | null;
}) {
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
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function SettingsSidebar() {
  const pathname = usePathname();

  return (
    <aside aria-label="Settings navigation" className="settings-sidebar">
      <Link className="settings-sidebar-back" href="/dashboard">
        <ArrowLeft aria-hidden="true" className="settings-sidebar-icon" />
        <span>Back to Dashboard</span>
      </Link>

      <SettingsNavGroup
        items={personalNav}
        label="Personal"
        pathname={pathname}
      />
      <SettingsNavGroup
        items={organizationNav}
        label="Organization"
        pathname={pathname}
      />
    </aside>
  );
}
