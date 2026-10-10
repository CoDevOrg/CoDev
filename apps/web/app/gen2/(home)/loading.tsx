import { Brand } from "@/components/shell/app-chrome";
import { AppSidebarFrame } from "@/components/shell/app-sidebar-frame";
import { AppSidebarNav } from "@/components/shell/app-sidebar-nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { WorkspaceHomeSkeleton } from "@/components/gen2/workspace-home-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the workspace home loads its workspaces, GitHub, and billing
 * state, so returning from a workspace paints immediately. Scoped to this
 * route group so opening a workspace does not flash the dashboard skeleton.
 *
 * The page renders inside the app sidebar, so the skeleton does too (through
 * the same frame, which honors a collapsed sidebar); only the account row,
 * which needs the signed-in member, is a placeholder.
 */
export default function Gen2HomeLoading() {
  return (
    <AppSidebarFrame
      sidebar={
        <aside className="app-sidebar" id="app-sidebar">
          <div className="app-sidebar-header">
            <Brand />
          </div>
          <AppSidebarNav />
          <div className="app-sidebar-footer">
            <ThemeToggle compact />
            <div className="gen2-skeleton-profile" aria-hidden="true">
              <Skeleton className="size-[30px] shrink-0 rounded-full" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          </div>
        </aside>
      }
    >
      <WorkspaceHomeSkeleton />
    </AppSidebarFrame>
  );
}
