"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Settings } from "lucide-react";

const navItems = [
  { href: "/dashboard", icon: LayoutGrid, label: "Workspaces" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function AppSidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="app-sidebar-nav" aria-label="Application navigation">
      {navItems.map(({ href, icon: Icon, label }) => {
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
