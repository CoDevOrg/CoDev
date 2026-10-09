"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cloud, MessagesSquare, Settings, ShieldCheck } from "lucide-react";

import { ADMIN_HANDOFF_PATH, publicAppHref } from "@/lib/platform/site-hosts";

const ADMIN_CONSOLE_URL = "https://admins.trycodev.com";

const navItems = [
  { href: "/gen2", icon: Cloud, label: "Workspaces" },
  { href: "/rooms", icon: MessagesSquare, label: "Rooms" },
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
        {
          // The admin host has its own session; the public site hands it over.
          href: isAdminHost ? ADMIN_CONSOLE_URL : ADMIN_HANDOFF_PATH,
          icon: ShieldCheck,
          label: "Admin",
        },
      ]
    : navItems;
  return (
    <nav className="app-sidebar-nav" aria-label="Application navigation">
      {items.map(({ href, icon: Icon, label }) => {
        const external = href.startsWith("http") || href === ADMIN_HANDOFF_PATH;
        const active = external
          ? false
          : pathname === href || pathname.startsWith(href + "/");
        const resolved = external ? href : publicAppHref(href, isAdminHost);
        const className = `app-sidebar-link${active ? " is-active" : ""}`;
        if (external || resolved.startsWith("http")) {
          return (
            <a key={href} href={resolved} className={className}>
              <Icon className="app-sidebar-link-icon" aria-hidden="true" />
              {label}
            </a>
          );
        }
        return (
          <Link key={href} href={resolved} className={className}>
            <Icon className="app-sidebar-link-icon" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
