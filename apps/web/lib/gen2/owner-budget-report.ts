import "server-only";
import { lt } from "drizzle-orm";
import { schema } from "@codev/db";
import type { Gen2OwnerBudgetReport } from "@codev/contracts";
import { getDatabase } from "../platform/database";
import { Gen2LifecycleError } from "./errors";
const monthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Only the authenticated collector may publish complete cumulative snapshots. */
export async function recordOwnerBudget(
  report: Gen2OwnerBudgetReport,
  now = new Date(),
) {
  const month = new Date(report.month);
  const observedAt = new Date(report.observedAt);
  if (
    month.getTime() !== monthStart(month).getTime() ||
    month > now ||
    observedAt < month ||
    observedAt > now
  ) {
    throw new Gen2LifecycleError("Invalid cost snapshot period.", 400);
  }
  const values = {
    ownerId: report.ownerId,
    month,
    observedAt,
    blocked: report.blocked,
    computeCents: report.computeCents,
    storageCents: report.storageCents,
    networkCents: report.networkCents,
    operationsCents: report.operationsCents,
    otherCents: report.otherCents,
  };
  const updated = await getDatabase()
    .insert(schema.gen2OwnerBudgets)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.gen2OwnerBudgets.ownerId, schema.gen2OwnerBudgets.month],
      set: values,
      setWhere: lt(schema.gen2OwnerBudgets.observedAt, observedAt),
    })
    .returning({ ownerId: schema.gen2OwnerBudgets.ownerId });
  return updated.length > 0;
}
