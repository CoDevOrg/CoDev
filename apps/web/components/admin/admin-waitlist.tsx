"use client";

import { useMemo, useState, useTransition } from "react";
import { Clock, Search, CheckCircle2, XCircle } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { declineWaitlistEntry, inviteWaitlistEntry } from "@/app/admin/actions";
import { AdminNotice, type AdminNoticeResult } from "./admin-notice";
import { formatDate, formatNumber } from "./admin-formatters";
import type {
  AccessRequestRow,
  WaitlistActionResult,
} from "@/lib/admin/access-requests";

type Filter = "all" | "pending" | "invited" | "accepted" | "declined";

export function AdminWaitlist({ rows }: { rows: AccessRequestRow[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<AdminNoticeResult>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  const counts = useMemo(
    () =>
      rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      }, {}),
    [rows],
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.email.toLowerCase().includes(q) ||
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.persona && r.persona.toLowerCase().includes(q)) ||
        (r.building && r.building.toLowerCase().includes(q))
      );
    });
  }, [rows, filter, search]);

  function run(
    id: string,
    action: (id: string) => Promise<WaitlistActionResult>,
  ) {
    setPendingId(id);
    setNotice(null);
    startTransition(async () => {
      const result = await action(id);
      setNotice(result);
      setPendingId(null);
    });
  }

  const filters: Filter[] = [
    "all",
    "pending",
    "invited",
    "accepted",
    "declined",
  ];

  return (
    <Card className="border-border/80 bg-card/60 backdrop-blur-xs">
      <CardHeader className="flex flex-col gap-4 pb-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Clock className="size-4 text-primary" /> Waitlist Applications
            </CardTitle>
            <CardDescription>
              Registration is currently gated. Review access requests and launch
              planning.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="w-fit text-xs text-muted-foreground"
          >
            {filtered.length} of {rows.length} applications
          </Badge>
        </div>

        <AdminNotice result={notice} />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-1">
            {filters.map((val) => {
              const count = val === "all" ? rows.length : (counts[val] ?? 0);
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setFilter(val)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    filter === val
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {val} ({formatNumber(count)})
                </button>
              );
            })}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-y border-border/60 bg-muted/30 text-[11px] font-medium uppercase text-muted-foreground">
                <th className="py-2.5 pl-4 pr-3">Requested</th>
                <th className="px-3 py-2.5">Person / Company</th>
                <th className="px-3 py-2.5">Building</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Invited</th>
                <th className="py-2.5 pl-3 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No waitlist requests found for this filter.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="py-2.5 pl-4 pr-3 whitespace-nowrap text-muted-foreground">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">
                          {row.name ?? "Unnamed"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {row.email}
                          {row.persona ? ` · ${row.persona}` : ""}
                        </span>
                      </div>
                    </td>
                    <td
                      className="px-3 py-2.5 text-muted-foreground max-w-xs truncate"
                      title={row.building ?? undefined}
                    >
                      {row.building || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-medium capitalize ${
                          row.status === "accepted"
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : row.status === "invited"
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : row.status === "declined"
                                ? "border-destructive/40 bg-destructive/10 text-destructive"
                                : "text-muted-foreground"
                        }`}
                      >
                        {row.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatDate(row.invitedAt)}
                    </td>
                    <td className="py-2.5 pl-3 pr-4 text-right">
                      {row.status === "pending" ? (
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pendingId === row.id}
                            onClick={() => run(row.id, inviteWaitlistEntry)}
                            className="h-7 text-xs"
                          >
                            <CheckCircle2 className="size-3 text-primary mr-1" />
                            Invite
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pendingId === row.id}
                            onClick={() => run(row.id, declineWaitlistEntry)}
                            className="h-7 text-xs text-muted-foreground hover:text-destructive"
                          >
                            <XCircle className="size-3 mr-1" />
                            Decline
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
