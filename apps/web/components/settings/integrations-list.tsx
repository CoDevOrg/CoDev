"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { OrcaCard } from "@/components/settings/orca-style";
import { cn } from "@/lib/utils";

export type IntegrationRow = {
  id: string;
  name: string;
  icon: ReactNode;
  statusText: string;
  connected: boolean;
  action: ReactNode;
};

export function IntegrationsList({ rows }: { rows: IntegrationRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(needle));
  }, [query, rows]);
  const installedCount = rows.filter((row) => row.connected).length;

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search integrations"
          value={query}
        />
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium tracking-[0.05em] text-muted-foreground uppercase">
          Installed {installedCount}
        </p>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No integrations match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => (
              <OrcaCard
                className="flex items-center justify-between gap-3 px-4 py-3"
                key={row.id}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
                    {row.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{row.name}</p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          row.connected
                            ? "bg-emerald-400"
                            : "bg-muted-foreground/50",
                        )}
                      />
                      {row.statusText}
                    </p>
                  </div>
                </div>
                {row.action}
              </OrcaCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
