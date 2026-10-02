import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

export function SettingsConnectionRow({
  action,
  connected,
  icon,
  name,
  statusText,
}: {
  action?: ReactNode;
  connected: boolean;
  icon: ReactNode;
  name: string;
  statusText: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <Badge variant={connected ? "secondary" : "muted"}>
            {statusText}
          </Badge>
        </div>
      </div>
      {action}
    </div>
  );
}
