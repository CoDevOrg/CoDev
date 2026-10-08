import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the workspace home loads its workspaces, GitHub, and billing
 * state, so returning from a workspace paints immediately. Scoped to this
 * route group so opening a workspace does not flash the dashboard skeleton.
 */
export default function Gen2HomeLoading() {
  return (
    <main
      className="gen2-shell"
      aria-busy="true"
      aria-label="Loading workspaces"
    >
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-20" />
        ))}
      </div>
      <div className="mt-8 grid gap-3">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-16" />
        ))}
      </div>
    </main>
  );
}
