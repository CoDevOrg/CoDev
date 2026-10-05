import "server-only";
import { getDatabase } from "../platform/database";
import type { ComputeDatabase } from "./compute-database";
import { getOwnerBudget } from "./owner-budget";
import { Gen2LifecycleError } from "./errors";

export async function assertOwnerBudget(
  ownerId: string,
  db: ComputeDatabase = getDatabase(),
  now = new Date(),
) {
  if (!(await getOwnerBudget(ownerId, now, db)).blocked) return;
  throw new Gen2LifecycleError(
    "Free workspace compute is paused by the monthly resource budget guard. Your workspace is saved.",
    429,
  );
}
