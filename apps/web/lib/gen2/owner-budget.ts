import "server-only";
import type { Gen2OwnerBudgetSummary } from "@codev/contracts";
import { and, eq } from "drizzle-orm";
import { schema } from "@codev/db";
import { getDatabase } from "../platform/database";
import type { ComputeDatabase } from "./compute-database";

import { GEN2_FREE_OWNER_MONTHLY_BUDGET_CENTS } from "../billing/config";
export const FREE_OWNER_BUDGET_CENTS = GEN2_FREE_OWNER_MONTHLY_BUDGET_CENTS;
const MAX_AGE_MS = 24 * 3_600_000;
const monthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function getOwnerBudget(
  ownerId: string,
  now = new Date(),
  db: ComputeDatabase = getDatabase(),
): Promise<Gen2OwnerBudgetSummary> {
  const [row] = await db
    .select()
    .from(schema.gen2OwnerBudgets)
    .where(
      and(
        eq(schema.gen2OwnerBudgets.ownerId, ownerId),
        eq(schema.gen2OwnerBudgets.month, monthStart(now)),
      ),
    )
    .limit(1);
  const spentCents = row
    ? row.computeCents +
      row.storageCents +
      row.networkCents +
      row.operationsCents +
      row.otherCents
    : null;
  const fresh = Boolean(
    row &&
    row.observedAt <= now &&
    now.getTime() - row.observedAt.getTime() <= MAX_AGE_MS,
  );
  return {
    spentCents,
    limitCents: FREE_OWNER_BUDGET_CENTS,
    observedAt: row?.observedAt.toISOString() ?? null,
    blocked:
      !fresh ||
      Boolean(row?.blocked) ||
      (spentCents !== null && spentCents >= FREE_OWNER_BUDGET_CENTS),
  };
}
