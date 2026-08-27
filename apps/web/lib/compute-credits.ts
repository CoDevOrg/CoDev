import "server-only";

import { and, eq, isNull, or, sql } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "./database";
import { OrchestratorError, getIde } from "./orchestrator";
import { closeSandboxInterval, openSandboxInterval } from "./vm-usage";
import { listWorkspaceMembers } from "./workspaces";

/**
 * $5/member/month, pooled across a workspace's members (3 members = $15 for
 * that workspace) — the beta cost ceiling. Unlike vm-usage.ts's per-user
 * *lifetime* quota (kept in place, unrelated), this is workspace-pooled and
 * resets every calendar month.
 */
export const MONTHLY_CREDIT_USD_PER_MEMBER = 5;
// Estimate, not live AWS billing data — matches the shared host's current
// m7i-flex.large spot price in us-east-2 (~$0.0388/hr as of the cost audit
// this was built from). Revisit if pricing or instance type changes
// materially.
const HOST_HOURLY_RATE_USD = 0.0388;
export const MONTHLY_MINUTES_PER_MEMBER = Math.floor(
  (MONTHLY_CREDIT_USD_PER_MEMBER / HOST_HOURLY_RATE_USD) * 60,
);

/**
 * Orca's IDE session — not the Firecracker sandbox — is the primary compute
 * surface today (see orca-host.ts). Tagging its intervals with a distinct
 * source keeps them independently trackable from the sandbox's own
 * "provision"/"hibernate"/"stop" intervals in the same shared table, so
 * opening/closing one never clobbers the other for a workspace using both.
 */
const ORCA_INTERVAL_SOURCE = "orca-provision";

function minutesBetween(startedAt: Date, endedAt: Date) {
  const ms = Math.max(0, endedAt.getTime() - startedAt.getTime());
  return Math.max(1, Math.ceil(ms / 60_000));
}

function startOfCurrentMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Minutes of compute a single member has used this calendar month, across
 * every workspace they belong to — closed intervals plus live elapsed time
 * on any still-open interval. Always queries sandbox_runtime_intervals
 * directly rather than a rolling counter (vm-usage.ts's userComputeUsage is
 * lifetime-only and unrelated to this monthly scope), so correctness never
 * depends on a reset job having run.
 */
async function getMemberMinutesUsedThisMonth(userId: string) {
  const db = getDatabase();
  const monthStart = startOfCurrentMonth();
  const now = new Date();
  const intervals = await db
    .select({
      startedAt: schema.sandboxRuntimeIntervals.startedAt,
      endedAt: schema.sandboxRuntimeIntervals.endedAt,
    })
    .from(schema.sandboxRuntimeIntervals)
    .where(
      and(
        eq(schema.sandboxRuntimeIntervals.userId, userId),
        or(
          isNull(schema.sandboxRuntimeIntervals.endedAt),
          sql`${schema.sandboxRuntimeIntervals.endedAt} >= ${monthStart}`,
        ),
      ),
    );
  return intervals.reduce((total, interval) => {
    const started =
      interval.startedAt < monthStart ? monthStart : interval.startedAt;
    const ended = interval.endedAt ?? now;
    return total + minutesBetween(started, ended);
  }, 0);
}

export async function getWorkspaceCreditStatus(workspaceId: string) {
  const members = await listWorkspaceMembers(workspaceId);
  const allottedMinutes = members.length * MONTHLY_MINUTES_PER_MEMBER;
  const usedMinutes = (
    await Promise.all(
      members.map((member) => getMemberMinutesUsedThisMonth(member.userId)),
    )
  ).reduce((total, minutes) => total + minutes, 0);
  return {
    allottedMinutes,
    usedMinutes,
    remainingMinutes: Math.max(0, allottedMinutes - usedMinutes),
  };
}

export async function openOrcaInterval(userId: string, workspaceId: string) {
  await openSandboxInterval(
    userId,
    workspaceId,
    ORCA_INTERVAL_SOURCE,
    ORCA_INTERVAL_SOURCE,
  );
}

/**
 * The orchestrator's own idle-timeout reaper can tear down an Orca session
 * without ever telling the app — there's no webhook back. Call
 * periodically (piggybacking on the existing lifecycle cron) to close any
 * interval left open for a workspace whose Orca session isn't actually
 * running anymore. Credit-check correctness doesn't depend on how promptly
 * this runs — getMemberMinutesUsedThisMonth already counts live elapsed
 * time on still-open intervals — so cron-cadence lag here only affects DB
 * tidiness, not billing accuracy.
 */
export async function closeOrphanOrcaIntervals() {
  const db = getDatabase();
  const open = await db
    .select({ workspaceId: schema.sandboxRuntimeIntervals.workspaceId })
    .from(schema.sandboxRuntimeIntervals)
    .where(
      and(
        eq(schema.sandboxRuntimeIntervals.source, ORCA_INTERVAL_SOURCE),
        isNull(schema.sandboxRuntimeIntervals.endedAt),
      ),
    );
  const unique = [...new Set(open.map((row) => row.workspaceId))];
  let closed = 0;
  for (const workspaceId of unique) {
    const stillRunning = await getIde(workspaceId)
      .then(() => true)
      .catch((error: unknown) => {
        if (error instanceof OrchestratorError && error.status === 404) {
          return false;
        }
        // Any other error (host unreachable, etc.) - leave the interval
        // open rather than guessing; the next cron run retries.
        return true;
      });
    if (!stillRunning) {
      await closeSandboxInterval(
        workspaceId,
        "reconcile",
        ORCA_INTERVAL_SOURCE,
      );
      closed += 1;
    }
  }
  return closed;
}
