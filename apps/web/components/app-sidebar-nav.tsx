"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  MessageSquarePlus,
  Settings,
  ShieldCheck,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", icon: LayoutGrid, label: "Workspaces" },
  { href: "/import", icon: MessageSquarePlus, label: "Import chat" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function AppSidebarNav({ showAdmin = false }: { showAdmin?: boolean }) {
  const pathname = usePathname();
  const items = showAdmin
    ? [...navItems, { href: "/admin", icon: ShieldCheck, label: "Admin" }]
    : navItems;
  return (
    <nav className="app-sidebar-nav" aria-label="Application navigation">
      {items.map(({ href, icon: Icon, label }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={`app-sidebar-link${active ? " is-active" : ""}`}
          >
            <Icon className="app-sidebar-link-icon" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
