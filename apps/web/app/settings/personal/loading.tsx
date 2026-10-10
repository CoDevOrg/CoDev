import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown the moment a settings tab is clicked (and prefetched with the link),
 * so the page responds before the server finishes reading the account.
 */
export default function SettingsLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading settings"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      {[0, 1].map((card) => (
        <Card className="flex flex-col gap-3 p-4" key={card}>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full max-w-sm" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </Card>
      ))}
    </div>
  );
}
