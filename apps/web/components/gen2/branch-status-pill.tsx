import { cn } from "@/lib/platform/utils";
import type { BranchStatus } from "./workspace-branch-menu";

/** Renders nothing while a branch's file count is unknown, never a placeholder dash. */
export function BranchStatusPill({
  status,
  className,
}: {
  status: BranchStatus | null;
  className: string;
}) {
  if (!status || status.tone === "unknown") return null;
  return <span className={cn(className, status.tone)}>{status.label}</span>;
}
