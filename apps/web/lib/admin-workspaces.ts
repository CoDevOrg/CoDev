import "server-only";

import { desc, eq, isNull, or, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { schema } from "@codev/db";

import { getDatabase } from "./database";
import {
  COST_TRACKING_START_DATE,
  getRealCodevAwsSpend,
} from "./aws-cost";

export interface AdminWorkspaceMember {
  userId: string;
  login: string;
  name: string | null;
  accessRole: "owner" | "co_steer" | "reviewer" | "viewer";
  joinedAt: string;
}

export interface AdminWorkspaceRow {
  id: string;
  repository: string;
  defaultBranch: string;
  status: string;
  isDeleted: boolean;
  ownerId: string;
  ownerLogin: string;
  ownerName: string | null;
  createdAt: string;
  deletedAt: string | null;
  members: AdminWorkspaceMember[];
  /** Minutes of sandbox/IDE runtime recorded since cost tracking began. */
  trackedMinutes: number;
  /**
   * This workspace's share of the real EC2 bill, in proportion to its real
   * recorded runtime minutes. Null until any workspace has recorded minutes
   * in the tracked window (nothing to allocate yet).
   */
  estimatedCostUsd: number | null;
}

export interface AdminWorkspacesReport {
  workspaces: AdminWorkspaceRow[];
  costTracking: {
    trackedSinceIso: string;
    totalRealSpendUsd: number;
    attributableEc2Usd: number;
    platformOverheadUsd: number;
    totalTrackedMinutes: number;
  };
}

function minutesBetween(startedAt: Date, endedAt: Date) {
  const ms = Math.max(0, endedAt.getTime() - startedAt.getTime());
  return Math.max(0, Math.ceil(ms / 60_000));
}

export async function listAllWorkspacesForAdmin(): Promise<AdminWorkspacesReport> {
  const db = getDatabase();
  const owner = alias(schema.users, "owner");

  const [workspaceRows, memberRows, intervalRows, spend] = await Promise.all([
    db
      .select({
        id: schema.workspaces.id,
        repository: schema.workspaces.repository,
        defaultBranch: schema.workspaces.defaultBranch,
        status: schema.workspaces.status,
        ownerId: schema.workspaces.ownerId,
        ownerLogin: owner.login,
        ownerName: owner.name,
        createdAt: schema.workspaces.createdAt,
        deletedAt: schema.workspaces.deletedAt,
      })
      .from(schema.workspaces)
      .innerJoin(owner, eq(schema.workspaces.ownerId, owner.id))
      .orderBy(desc(schema.workspaces.createdAt)),
    db
      .select({
        workspaceId: schema.workspaceMembers.workspaceId,
        userId: schema.users.id,
        login: schema.users.login,
        name: schema.users.name,
        accessRole: schema.workspaceMembers.accessRole,
        joinedAt: schema.workspaceMembers.joinedAt,
      })
      .from(schema.workspaceMembers)
      .innerJoin(
        schema.users,
        eq(schema.workspaceMembers.userId, schema.users.id),
      ),
    db
      .select({
        workspaceId: schema.sandboxRuntimeIntervals.workspaceId,
        startedAt: schema.sandboxRuntimeIntervals.startedAt,
        endedAt: schema.sandboxRuntimeIntervals.endedAt,
      })
      .from(schema.sandboxRuntimeIntervals)
      .where(
        or(
          isNull(schema.sandboxRuntimeIntervals.endedAt),
          gte(
            schema.sandboxRuntimeIntervals.endedAt,
            new Date(COST_TRACKING_START_DATE),
          ),
        ),
      ),
    getRealCodevAwsSpend(),
  ]);

  const trackingStart = new Date(COST_TRACKING_START_DATE);
  const now = new Date();

  const minutesByWorkspace = new Map<string, number>();
  for (const interval of intervalRows) {
    const started =
      interval.startedAt < trackingStart ? trackingStart : interval.startedAt;
    const ended = interval.endedAt ?? now;
    minutesByWorkspace.set(
      interval.workspaceId,
      (minutesByWorkspace.get(interval.workspaceId) ?? 0) +
        minutesBetween(started, ended),
    );
  }
  const totalTrackedMinutes = [...minutesByWorkspace.values()].reduce(
    (total, minutes) => total + minutes,
    0,
  );

  const membersByWorkspace = new Map<string, AdminWorkspaceMember[]>();
  for (const member of memberRows) {
    const list = membersByWorkspace.get(member.workspaceId) ?? [];
    list.push({
      userId: member.userId,
      login: member.login,
      name: member.name,
      accessRole: member.accessRole,
      joinedAt: member.joinedAt.toISOString(),
    });
    membersByWorkspace.set(member.workspaceId, list);
  }

  const workspaces: AdminWorkspaceRow[] = workspaceRows.map((workspace) => {
    const trackedMinutes = minutesByWorkspace.get(workspace.id) ?? 0;
    return {
      id: workspace.id,
      repository: workspace.repository,
      defaultBranch: workspace.defaultBranch,
      status: workspace.status,
      isDeleted: workspace.deletedAt !== null,
      ownerId: workspace.ownerId,
      ownerLogin: workspace.ownerLogin,
      ownerName: workspace.ownerName,
      createdAt: workspace.createdAt.toISOString(),
      deletedAt: workspace.deletedAt?.toISOString() ?? null,
      members: (membersByWorkspace.get(workspace.id) ?? []).sort(
        (left, right) => left.joinedAt.localeCompare(right.joinedAt),
      ),
      trackedMinutes,
      estimatedCostUsd:
        totalTrackedMinutes > 0
          ? (trackedMinutes / totalTrackedMinutes) * spend.ec2Usd
          : null,
    };
  });

  return {
    workspaces,
    costTracking: {
      trackedSinceIso: trackingStart.toISOString(),
      totalRealSpendUsd: spend.totalUsd,
      attributableEc2Usd: spend.ec2Usd,
      platformOverheadUsd: spend.overheadUsd,
      totalTrackedMinutes,
    },
  };
}
