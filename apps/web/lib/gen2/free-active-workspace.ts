import "server-only";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { schema } from "@codev/db";
import type { ComputeDatabase } from "./compute-database";

export async function findOtherOwnerCompute(
  db: ComputeDatabase,
  ownerId: string,
  workspaceId: string,
) {
  const others = await db
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
          inArray(schema.gen2Workspaces.runtimeStatus, [
            "queued",
            "provisioning",
            "booting",
            "attaching_disk",
            "starting_tunnel",
            "checking_readiness",
            "ready",
            "stopping",
          ]),
          eq(schema.gen2FreeComputeClaims.ownerId, ownerId),
          eq(schema.gen2ComputeSessions.ownerId, ownerId),
        ),
      ),
    );
  return Array.from(new Map(others.map((row) => [row.id, row])).values());
}
