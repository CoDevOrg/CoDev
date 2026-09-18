"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  MessagesSquare,
  MessageSquarePlus,
  Settings,
  ShieldCheck,
} from "lucide-react";

import { publicAppHref } from "@/lib/platform/site-hosts";

const ADMIN_CONSOLE_URL = "https://admins.trycodev.com";

const navItems = [
  { href: "/dashboard", icon: LayoutGrid, label: "Workspaces" },
  { href: "/rooms", icon: MessagesSquare, label: "Rooms" },
  { href: "/import", icon: MessageSquarePlus, label: "Import chat" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export function AppSidebarNav({
  showAdmin = false,
  isAdminHost = false,
}: {
  showAdmin?: boolean;
  isAdminHost?: boolean;
}) {
  const pathname = usePathname();
  const items = showAdmin
    ? [
        ...navItems,
        { href: ADMIN_CONSOLE_URL, icon: ShieldCheck, label: "Admin" },
      ]
    : navItems;
  return (
    <nav className="app-sidebar-nav" aria-label="Application navigation">
      {items.map(({ href, icon: Icon, label }) => {
        const active = href.startsWith("http")
          ? false
          : pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={
              href.startsWith("http") ? href : publicAppHref(href, isAdminHost)
            }
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
