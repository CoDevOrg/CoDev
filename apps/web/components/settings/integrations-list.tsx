"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { SettingsConnectionRow } from "@/components/settings/settings-connection-row";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

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
    <div className="flex flex-col gap-5">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search integrations"
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search integrations"
          value={query}
        />
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Installed {installedCount}
        </p>
        {filtered.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                No integrations match &ldquo;{query}&rdquo;.
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((row, index) => (
              <div className="flex flex-col gap-3" key={row.id}>
                {index > 0 ? <Separator /> : null}
                <SettingsConnectionRow
                  action={row.action}
                  connected={row.connected}
                  icon={row.icon}
                  name={row.name}
                  statusText={row.statusText}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
