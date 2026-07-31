# DUAL_TIER_SETTINGS_SPEC.md

> **Document Scope:** Specification for the Dual-Tier Settings Architecture (Personal Scope vs. Organization/Workspace Scope), Navigation UI Component, OpenFGA Permission Controls, and Settings Routing for **CoDev**.

---

## 1. Information Architecture & Route Mapping

CoDev separates user-level configuration from team-level configuration. Personal settings control individual user preferences, private BYOK keys, and profile details. Organization settings govern shared team resources, billing, permissions, and fallback credentials.

```text
/settings
├── personal/                          # User-Scoped Settings (Private)
│   ├── profile                        # Name, Avatar, Email, Security & SSO
│   ├── agents                         # Personal BYOK Keys (Claude, OpenAI, Bedrock, Cursor)
│   ├── integrations                   # Personal OAuth (Personal GitHub handle for PRs)
│   ├── api-keys                       # Personal CoDev CLI & SDK access tokens
│   └── preferences                    # Theme, Keybindings, Preferred default LLM
│
└── org/                               # Organization/Workspace-Scoped Settings (Shared)
    ├── agents                         # Team BYOK Keys & Fallback Credential Pool
    ├── integrations                   # Team Repositories (GitHub Org, Supabase, Vercel, AWS)
    ├── general                        # Org Name, Slug, Domain Restrictions, Default Roles
    ├── billing                        # Subscriptions, Token Budgets, Compute Seats
    ├── members                        # Member Invites, Role Management (Owner, Co-Steer, etc.)
    └── audit-log                      # Security events, Agent action logs, Key usage history

```

---

## 2. Personal Scope vs. Organization Scope Matrix

| Feature Area        | Personal Scope (`/settings/personal/*`)                                                | Organization Scope (`/settings/org/*`)                                                       |
| ------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Target Audience** | Individual Logged-In User.                                                             | All Members of the Active Workspace / Organization.                                          |
| **Coding Agents**   | Private keys linked to the user's account. Takes top priority during agent resolution. | Shared team key pool managed by Admins. Used as fallback when personal keys are unset.       |
| **Integrations**    | Personal OAuth tokens (e.g., individual GitHub handle for PR authoring).               | Organization OAuth tokens (e.g., main GitHub Organization, shared Supabase/Vercel projects). |
| **API Keys**        | Programmatic access tokens for the CoDev CLI and custom developer scripts.             | Managed via Member Role Access Control and Organization Service Accounts.                    |
| **Access Control**  | Strictly editable by the individual account holder.                                    | Governed by **OpenFGA** roles (`Owner`/`Admin` edit access; `Reviewer`/`Viewer` read-only).  |

---

## 3. Navigation Sidebar Component (`/apps/web/components/settings/SettingsSidebar.tsx`)

```tsx
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  User,
  Bot,
  Plug,
  Key,
  Sliders,
  Settings,
  CreditCard,
  Users,
  ShieldAlert,
  ArrowLeft,
} from "lucide-react";

const personalNav = [
  { name: "Profile", href: "/settings/personal/profile", icon: User },
  { name: "Coding Agents", href: "/settings/personal/agents", icon: Bot },
  { name: "Integrations", href: "/settings/personal/integrations", icon: Plug },
  { name: "API Keys", href: "/settings/personal/api-keys", icon: Key },
  {
    name: "Preferences",
    href: "/settings/personal/preferences",
    icon: Sliders,
  },
];

const orgNav = [
  { name: "Coding Agents", href: "/settings/org/agents", icon: Bot },
  { name: "Integrations", href: "/settings/org/integrations", icon: Plug },
  { name: "Settings", href: "/settings/org/general", icon: Settings },
  { name: "Billing", href: "/settings/org/billing", icon: CreditCard },
  { name: "Members", href: "/settings/org/members", icon: Users },
  { name: "Audit Log", href: "/settings/org/audit-log", icon: ShieldAlert },
];

export function SettingsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-950 p-4 min-h-screen text-zinc-300">
      <Link
        href="/dashboard"
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      {/* Personal Settings Group */}
      <div className="mb-6">
        <h3 className="px-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Personal
        </h3>
        <nav className="space-y-1">
          {personalNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-950/50 text-emerald-400 border-l-2 border-emerald-500"
                    : "hover:bg-zinc-900 text-zinc-400 hover:text-white"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Organization Settings Group */}
      <div>
        <h3 className="px-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Organization
        </h3>
        <nav className="space-y-1">
          {orgNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-950/50 text-emerald-400 border-l-2 border-emerald-500"
                    : "hover:bg-zinc-900 text-zinc-400 hover:text-white"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
```

---

## 4. OpenFGA Permission Guard for Organization Settings

To ensure non-admin team members cannot tamper with team API keys, billing, or audit logs, all `/settings/org/*` routes enforce an OpenFGA relationship check before rendering mutation controls or secret fields:

```typescript
import { openFgaClient } from "@/lib/openfga";

export async function checkOrgSettingsAccess(
  userId: string,
  orgId: string,
  action: "read" | "write",
) {
  const relation = action === "write" ? "owner" : "viewer";

  const { allowed } = await openFgaClient.check({
    user: `user:${userId}`,
    relation,
    object: `organization:${orgId}`,
  });

  if (!allowed) {
    throw new Error(
      "Unauthorized: You do not have permission to modify organization settings.",
    );
  }
}
```
