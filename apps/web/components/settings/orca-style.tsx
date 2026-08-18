import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function OrcaPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="orca-settings-scope h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-8 py-10">
        {children}
      </div>
    </div>
  );
}

export function OrcaPageHeader({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5">
      <div className="min-w-0 space-y-2">
        <h2 className="flex flex-wrap items-center gap-2 text-2xl leading-tight font-semibold text-foreground">
          {title}
          {badge ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
              {badge}
            </span>
          ) : null}
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

export function OrcaCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-card/50 px-7 py-6 shadow-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function OrcaSubsectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
