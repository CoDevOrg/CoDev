import { Cloud, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceLoading({
  title,
  description,
  className,
  busy = true,
  detail,
  action,
}: {
  title: string;
  description: string;
  className?: string;
  busy?: boolean;
  /** Replaces the placeholder bars while busy, e.g. real progress. */
  detail?: ReactNode;
  action?: ReactNode;
}) {
  const Mark = busy ? LoaderCircle : Cloud;
  return (
    <Empty className={className} role="status">
      <EmptyHeader>
        <EmptyMedia>
          <Mark
            className={busy ? "gen2-loading-mark" : undefined}
            aria-hidden="true"
          />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {busy && detail ? (
        detail
      ) : busy ? (
        <div className="flex w-full max-w-xs flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : null}
      {action}
    </Empty>
  );
}
