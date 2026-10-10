import { Skeleton } from "@/components/ui/skeleton";

/** The compute and slot tiles carry a usage meter; the first two do not. */
const STAT_METERS = [false, false, true, true];
const CARD_COUNT = 5;

function StatSkeleton({ meter }: { meter: boolean }) {
  return (
    <div className="gen2-stat">
      <Skeleton className="h-[15px] w-28" />
      <Skeleton className="h-[29px] w-20" />
      {meter ? <span className="gen2-stat-meter" /> : null}
      <Skeleton className="h-[15px] w-36 max-w-full" />
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="gen2-ws gen2-ws-grid">
      <div className="gen2-ws-link">
        <span className="gen2-ws-head">
          <Skeleton className="size-10 shrink-0 rounded-[11px]" />
          <span className="gen2-ws-main">
            <Skeleton className="my-[2px] h-[15px] w-32 max-w-full" />
            <Skeleton className="my-[2px] h-3 w-40 max-w-full" />
          </span>
        </span>
        <span className="gen2-ws-meta">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3.5 w-[100px]" />
          <Skeleton className="ml-auto h-5 w-[51px] rounded-full" />
        </span>
      </div>
    </div>
  );
}

/**
 * The workspace home's layout before its data arrives. It reuses the
 * dashboard's own layout classes (header, stat tiles, toolbar, card grid) so
 * nothing moves when the real page replaces it; only data becomes skeletons.
 */
export function WorkspaceHomeSkeleton() {
  return (
    <main className="gen2-shell" aria-busy="true">
      <span className="sr-only" role="status">
        Loading workspaces…
      </span>
      <div
        className="gen2-home-dashboard gen2-home-skeleton"
        aria-hidden="true"
      >
        <header className="gen2-home-header">
          <div className="gen2-home-heading">
            <p className="gen2-home-eyebrow">Workspace home</p>
            {/* An h1 so `.gen2-shell h1` sizes it exactly like the greeting;
                a span, since a heading only holds phrasing content. */}
            <h1 className="gen2-home-title">
              <span
                data-slot="skeleton"
                className="block h-[1.15em] w-[10em] max-w-full animate-pulse rounded-md bg-muted"
              />
            </h1>
            <p className="gen2-home-subtitle">
              Build together with people and AI agents.
            </p>
          </div>
          <div className="gen2-home-actions">
            <Skeleton className="h-9 w-[104px] rounded-full" />
            <Skeleton className="h-9 w-[167px]" />
          </div>
        </header>

        <section className="gen2-stats">
          {STAT_METERS.map((meter, index) => (
            <StatSkeleton key={index} meter={meter} />
          ))}
        </section>

        <div className="gen2-toolbar">
          <div className="gen2-search-box">
            <Skeleton className="h-9 w-full rounded-[10px]" />
          </div>
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-8 w-[62px] rounded-full" />
            <Skeleton className="h-8 w-[95px] rounded-full" />
            <Skeleton className="h-8 w-[95px] rounded-full" />
          </div>
          <div className="gen2-view-switcher flex items-center gap-1.5">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="size-8 rounded-full" />
          </div>
        </div>

        <div className="gen2-grid">
          <div className="gen2-new-card">
            <Skeleton className="mb-1 size-10 rounded-xl" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3.5 w-48 max-w-full" />
          </div>
          {Array.from({ length: CARD_COUNT }, (_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      </div>
    </main>
  );
}
