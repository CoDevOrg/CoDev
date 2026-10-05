"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, ArrowUpDown } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { updateAccountSubscription, updateApplicationAdmin } from "@/app/admin/actions";
import { AdminNotice, type AdminNoticeResult } from "./admin-notice";
import { AdminUserRow } from "./admin-user-row";

export type AdminUserDirectoryItem = {
  id: string;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  hasGithub: boolean;
  hasGoogle: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  visits: number;
  planId?: "free" | "pro" | "team" | "enterprise";
  subscriptionStatus?: string;
  provider?: string | null;
};

type RoleFilter = "all" | "admins" | "pro" | "standard";
type SortOption = "visits" | "lastSeen" | "joined" | "name";

export function AdminUserDirectory({
  users,
  currentUserId,
}: {
  users: AdminUserDirectoryItem[];
  currentUserId: string;
}) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("visits");
  const [result, setResult] = useState<AdminNoticeResult>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredUsers = useMemo(() => {
    return users
      .filter((user) => {
        if (roleFilter === "admins" && !user.isAdmin) return false;
        if (roleFilter === "pro" && user.planId !== "pro") return false;
        if (roleFilter === "standard" && user.isAdmin) return false;
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          user.login.toLowerCase().includes(q) ||
          (user.name && user.name.toLowerCase().includes(q)) ||
          (user.email && user.email.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortBy === "visits") return b.visits - a.visits;
        if (sortBy === "joined") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (sortBy === "lastSeen") {
          const aTime = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
          const bTime = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
          return bTime - aTime;
        }
        return (a.name ?? a.login).localeCompare(b.name ?? b.login);
      });
  }, [users, query, roleFilter, sortBy]);

  function handleToggleAdmin(user: AdminUserDirectoryItem) {
    const formData = new FormData();
    formData.set("userId", user.id);
    formData.set("isAdmin", (!user.isAdmin).toString());
    setPendingUserId(user.id);
    setResult(null);
    startTransition(async () => {
      setResult(await updateApplicationAdmin(formData));
      setPendingUserId(null);
    });
  }

  function handleToggleSubscription(user: AdminUserDirectoryItem) {
    const isPro = user.planId === "pro" && user.subscriptionStatus === "active";
    const formData = new FormData();
    formData.set("userId", user.id);
    formData.set("action", isPro ? "revoke" : "grant");
    setPendingUserId(user.id);
    setResult(null);
    startTransition(async () => {
      setResult(await updateAccountSubscription(formData));
      setPendingUserId(null);
    });
  }

  return (
    <Card className="border-border/80 bg-card/60 backdrop-blur-xs">
      <CardHeader className="flex flex-col gap-4 pb-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">User Directory</CardTitle>
            <CardDescription>
              Manage accounts, console permissions, and complimentary access
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit text-xs text-muted-foreground">
            {filteredUsers.length} of {users.length} accounts
          </Badge>
        </div>

        <AdminNotice result={result} />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, handle, or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-border/60 bg-muted/20 p-0.5 text-xs">
              {(["all", "admins", "pro", "standard"] as RoleFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setRoleFilter(f)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    roleFilter === f
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowUpDown className="size-3.5" />
              <select
                aria-label="Sort users by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="rounded-md border border-border/60 bg-card px-2 py-1 text-xs font-medium text-foreground outline-none"
              >
                <option value="visits">Most visits</option>
                <option value="lastSeen">Recently seen</option>
                <option value="joined">Newest first</option>
                <option value="name">Alphabetical</option>
              </select>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-y border-border/60 bg-muted/30 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <th className="py-2.5 pl-4 pr-3">User</th>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">Plan & Access</th>
                <th className="px-3 py-2.5">Auth</th>
                <th className="px-3 py-2.5">Joined</th>
                <th className="px-3 py-2.5">Last Seen</th>
                <th className="px-3 py-2.5 text-right">Visits</th>
                <th className="py-2.5 pl-3 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    No users matching your search or filters.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <AdminUserRow
                    key={user.id}
                    user={user}
                    currentUserId={currentUserId}
                    isPending={isPending && pendingUserId === user.id}
                    onToggleAdmin={handleToggleAdmin}
                    onToggleSubscription={handleToggleSubscription}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
