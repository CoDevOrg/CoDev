import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/platform/utils";

export function SettingsPageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}

export function SettingsPageHeader({
  badge,
  description,
  title,
}: {
  badge?: string;
  description: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="m-0 text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {badge ? <Badge variant="muted">{badge}</Badge> : null}
      </div>
      <p className="m-0 max-w-2xl text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
