import "server-only";
import { and, eq, isNull, isNotNull, ne, or } from "drizzle-orm";
import { schema } from "@codev/db";
import type { ComputeDatabase } from "./compute-database";

export async function findOtherOwnerCompute(
  db: ComputeDatabase,
  ownerId: string,
  workspaceId: string,
) {
  const [other] = await db
    .select({ id: schema.gen2Workspaces.id, name: schema.gen2Workspaces.name })
    .from(schema.gen2Workspaces)
    .leftJoin(
      schema.gen2ComputeSessions,
      and(
        eq(schema.gen2ComputeSessions.workspaceId, schema.gen2Workspaces.id),
        isNull(schema.gen2ComputeSessions.endedAt),
      ),
    )
    .leftJoin(
      schema.gen2FreeComputeClaims,
      eq(schema.gen2FreeComputeClaims.workspaceId, schema.gen2Workspaces.id),
    )
    .where(
      and(
        eq(schema.gen2Workspaces.ownerId, ownerId),
        ne(schema.gen2Workspaces.id, workspaceId),
        or(
          eq(schema.gen2Workspaces.status, "ready"),
          eq(schema.gen2Workspaces.status, "provisioning"),
          isNotNull(schema.gen2Workspaces.runtimeVmResourceId),
          eq(schema.gen2FreeComputeClaims.ownerId, ownerId),
          eq(schema.gen2ComputeSessions.ownerId, ownerId),
        ),
      ),
    )
    .limit(1);
  return other ?? null;
}
