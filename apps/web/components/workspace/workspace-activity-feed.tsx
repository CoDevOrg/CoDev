"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Bot,
  CalendarDays,
  FileText,
  GitPullRequest,
  History,
  Search,
  Users,
} from "lucide-react";

import {
  OrcaCard,
  OrcaPageHeader,
  OrcaPageShell,
} from "@/components/settings/orca-style";
import { Input } from "@/components/ui/input";
import type { ActivityAuditSnapshot } from "@/lib/workspaces/activity-audit-server";
import {
  filterActivityEvents,
  type ActivityEvent,
  type ActivityFilterKind,
} from "@/lib/workspaces/activity-audit-view";

function activityCategory(event: ActivityEvent) {
  if (event.jump?.kind === "file") return "Files";
  if (event.jump?.kind === "diff") return "Reviews & changes";
  if (event.jump?.kind === "session") return "Agent activity";
  return "Workspace";
}

function activityAction(event: ActivityEvent) {
  const prefix = `${event.actor} `;
  return event.summary.startsWith(prefix)
    ? event.summary.slice(prefix.length)
    : event.summary;
}

function activityTypeLabel(type: string) {
  return type
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function actorInitials(actor: string) {
  const words = actor.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

function dateLabel(key: string) {
  if (key === "unknown") return "Earlier activity";
  const [year = 1970, month = 1, day = 1] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  const todayKey = localDateKey(today.toISOString());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday.toISOString());
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function exactTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ActivityTypeIcon({ event }: { event: ActivityEvent }) {
  const Icon =
    event.jump?.kind === "file"
      ? FileText
      : event.jump?.kind === "diff"
        ? GitPullRequest
        : event.jump?.kind === "session"
          ? Bot
          : Activity;
  return <Icon aria-hidden size={15} />;
}

function groupEvents(events: ActivityEvent[]) {
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const key = localDateKey(event.createdAt);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: dateLabel(key),
    events: group,
  }));
}

async function readJsonError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

export function WorkspaceActivityFeed({
  workspaceId,
  repository,
  initialSnapshot,
}: {
  workspaceId: string;
  repository: string | null;
  initialSnapshot: ActivityAuditSnapshot;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>(initialSnapshot.events);
  const [cursor, setCursor] = useState<number | null>(
    initialSnapshot.nextCursor,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [kind, setKind] = useState<ActivityFilterKind>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filteredEvents = useMemo(
    () => filterActivityEvents(events, { kind, query }),
    [events, kind, query],
  );
  const groups = useMemo(() => groupEvents(filteredEvents), [filteredEvents]);
  const contributors = useMemo(
    () => new Set(events.map((event) => event.actor)).size,
    [events],
  );
  const categories = useMemo(
    () => new Set(events.map(activityCategory)).size,
    [events],
  );
  const latestEvent = events[0] ?? null;

  async function loadMore() {
    if (cursor == null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/events?before=${cursor}&limit=30`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(
          await readJsonError(response, "Could not load more activity."),
        );
      }
      const data = (await response.json()) as ActivityAuditSnapshot;
      setEvents((previous) => [...previous, ...data.events]);
      setCursor(data.nextCursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load more activity.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <OrcaPageShell>
      <Link
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        href={`/workspaces/${workspaceId}`}
      >
        <ArrowLeft aria-hidden size={14} />
        Back to workspace
      </Link>

      <OrcaPageHeader
        description={
          repository
            ? `See who changed ${repository}, what happened, and exactly when.`
            : "See who changed the workspace, what happened, and exactly when."
        }
        title="Activity"
      />

      {error ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <OrcaCard className="space-y-2 p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <History aria-hidden size={16} />
            <span className="text-xs font-medium uppercase tracking-[0.14em]">
              Events
            </span>
          </div>
          <p className="text-2xl font-semibold text-foreground">
            {events.length}
          </p>
          <p className="text-sm text-muted-foreground">
            {cursor == null ? "Complete history loaded" : "Most recent events"}
          </p>
        </OrcaCard>
        <OrcaCard className="space-y-2 p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users aria-hidden size={16} />
            <span className="text-xs font-medium uppercase tracking-[0.14em]">
              People
            </span>
          </div>
          <p className="text-2xl font-semibold text-foreground">
            {contributors}
          </p>
          <p className="text-sm text-muted-foreground">
            {categories} activity {categories === 1 ? "area" : "areas"}
          </p>
        </OrcaCard>
        <OrcaCard className="space-y-2 p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarDays aria-hidden size={16} />
            <span className="text-xs font-medium uppercase tracking-[0.14em]">
              Latest
            </span>
          </div>
          <p className="truncate text-base font-semibold text-foreground">
            {latestEvent
              ? exactTimestamp(latestEvent.createdAt)
              : "No activity yet"}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {latestEvent
              ? `${latestEvent.actor} · ${activityAction(latestEvent)}`
              : "Waiting for the first event"}
          </p>
        </OrcaCard>
      </div>

      <OrcaCard className="space-y-4 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Workspace history
            </h2>
            <p className="text-sm text-muted-foreground">
              A chronological record of changes, collaboration, and agent work.
            </p>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {filteredEvents.length}{" "}
            {filteredEvents.length === 1 ? "activity" : "activities"} shown
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={15}
            />
            <span className="sr-only">Search activity</span>
            <Input
              aria-label="Search activity"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people, files, or actions"
              value={query}
            />
          </label>
          <label className="sm:w-52">
            <span className="sr-only">Activity type</span>
            <select
              aria-label="Activity type"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) =>
                setKind(event.target.value as ActivityFilterKind)
              }
              value={kind}
            >
              <option value="all">All activity</option>
              <option value="file">Files</option>
              <option value="session">Agent activity</option>
              <option value="diff">Reviews &amp; changes</option>
            </select>
          </label>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <Activity
              aria-hidden
              className="mx-auto text-muted-foreground"
              size={22}
            />
            <p className="mt-3 text-sm font-medium text-foreground">
              {events.length === 0 ? "No activity yet" : "No matching activity"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {events.length === 0
                ? "Workspace changes and collaboration will appear here."
                : "Try a different person, file, action, or activity type."}
            </p>
          </div>
        ) : (
          <div className="space-y-7" aria-label="Workspace activity history">
            {groups.map((group) => (
              <section
                key={group.key}
                aria-labelledby={`activity-${group.key}`}
              >
                <h3
                  className="sticky top-0 z-10 border-b border-border/60 bg-background/95 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground backdrop-blur"
                  id={`activity-${group.key}`}
                >
                  {group.label}
                </h3>
                <ul className="divide-y divide-border/60">
                  {group.events.map((event) => (
                    <li className="flex gap-3 py-4" key={event.id}>
                      <div
                        aria-hidden
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                        title={event.actor}
                      >
                        {actorInitials(event.actor)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                          <p className="text-sm text-foreground">
                            <span className="font-semibold">{event.actor}</span>{" "}
                            <span className="text-muted-foreground">
                              {activityAction(event)}
                            </span>
                          </p>
                          <time
                            className="shrink-0 text-xs text-muted-foreground"
                            dateTime={event.createdAt}
                            title={exactTimestamp(event.createdAt)}
                          >
                            {exactTimestamp(event.createdAt)}
                          </time>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 font-medium">
                            <ActivityTypeIcon event={event} />
                            {activityCategory(event)}
                          </span>
                          <span>{activityTypeLabel(event.type)}</span>
                          {event.path ? (
                            <>
                              <span aria-hidden>·</span>
                              <code className="max-w-full truncate rounded bg-muted px-1.5 py-1 font-mono text-[11px]">
                                {event.path}
                              </code>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {cursor != null ? (
          <button
            className="w-full rounded-lg border border-border py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? "Loading older activity…" : "Load older activity"}
          </button>
        ) : (
          <p className="flex items-center justify-center gap-1.5 pt-2 text-center text-xs text-muted-foreground">
            <History aria-hidden size={12} />
            That&rsquo;s the beginning of this workspace&rsquo;s history.
          </p>
        )}
      </OrcaCard>
    </OrcaPageShell>
  );
}
