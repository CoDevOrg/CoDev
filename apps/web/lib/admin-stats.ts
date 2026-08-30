import "server-only";

import { and, countDistinct, desc, eq, gte, sql } from "drizzle-orm";

import { schema } from "@codev/db";

import { getDatabase } from "./database";

const DAY_MS = 24 * 60 * 60 * 1000;

function since(ms: number): Date {
  return new Date(Date.now() - ms);
}

export type AdminSummary = {
  totalUsers: number;
  newUsers7d: number;
  newUsers30d: number;
  totalViews: number;
  views24h: number;
  views7d: number;
  views30d: number;
  activeAccounts30m: number;
  activeAccounts24h: number;
  activeAccounts7d: number;
  uniqueVisitors7d: number;
};

export async function getAdminSummary(): Promise<AdminSummary> {
  const db = getDatabase();
  const views = schema.pageViews;
  const users = schema.users;

  const [
    [userCounts],
    [viewCounts],
    [active30m],
    [active24h],
    [active7d],
    [uniqueAnon7d],
  ] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        new7d: sql<number>`count(*) filter (where ${users.createdAt} >= ${since(7 * DAY_MS)})::int`,
        new30d: sql<number>`count(*) filter (where ${users.createdAt} >= ${since(30 * DAY_MS)})::int`,
      })
      .from(users),
    db
      .select({
        total: sql<number>`count(*)::int`,
        d1: sql<number>`count(*) filter (where ${views.createdAt} >= ${since(DAY_MS)})::int`,
        d7: sql<number>`count(*) filter (where ${views.createdAt} >= ${since(7 * DAY_MS)})::int`,
        d30: sql<number>`count(*) filter (where ${views.createdAt} >= ${since(30 * DAY_MS)})::int`,
      })
      .from(views),
    db
      .select({ value: countDistinct(views.userId) })
      .from(views)
      .where(
        and(
          gte(views.createdAt, since(30 * 60 * 1000)),
          sql`${views.userId} is not null`,
        ),
      ),
    db
      .select({ value: countDistinct(views.userId) })
      .from(views)
      .where(
        and(
          gte(views.createdAt, since(DAY_MS)),
          sql`${views.userId} is not null`,
        ),
      ),
    db
      .select({ value: countDistinct(views.userId) })
      .from(views)
      .where(
        and(
          gte(views.createdAt, since(7 * DAY_MS)),
          sql`${views.userId} is not null`,
        ),
      ),
    db
      .select({ value: countDistinct(views.ipHash) })
      .from(views)
      .where(gte(views.createdAt, since(7 * DAY_MS))),
  ]);

  return {
    totalUsers: userCounts?.total ?? 0,
    newUsers7d: userCounts?.new7d ?? 0,
    newUsers30d: userCounts?.new30d ?? 0,
    totalViews: viewCounts?.total ?? 0,
    views24h: viewCounts?.d1 ?? 0,
    views7d: viewCounts?.d7 ?? 0,
    views30d: viewCounts?.d30 ?? 0,
    activeAccounts30m: active30m?.value ?? 0,
    activeAccounts24h: active24h?.value ?? 0,
    activeAccounts7d: active7d?.value ?? 0,
    uniqueVisitors7d: uniqueAnon7d?.value ?? 0,
  };
}

export type AdminUserRow = {
  id: string;
  name: string | null;
  email: string | null;
  login: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  hasGithub: boolean;
  hasGoogle: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  visits: number;
};

export async function getUserDirectory(): Promise<AdminUserRow[]> {
  const db = getDatabase();
  const users = schema.users;
  const views = schema.pageViews;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      login: users.login,
      avatarUrl: users.avatarUrl,
      isAdmin: users.isAdmin,
      githubUserId: users.githubUserId,
      googleUserId: users.googleUserId,
      passwordHash: users.passwordHash,
      createdAt: users.createdAt,
      lastSeenAt: sql<Date | null>`max(${views.createdAt})`,
      visits: sql<number>`count(${views.id})::int`,
    })
    .from(users)
    .leftJoin(views, eq(views.userId, users.id))
    .groupBy(users.id)
    .orderBy(
      sql`max(${views.createdAt}) desc nulls last`,
      desc(users.createdAt),
    );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    login: row.login,
    avatarUrl: row.avatarUrl,
    isAdmin: row.isAdmin,
    hasGithub: row.githubUserId !== null,
    hasGoogle: row.googleUserId !== null,
    hasPassword: row.passwordHash !== null,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
    visits: row.visits ?? 0,
  }));
}

export type AdminRecentVisit = {
  id: string;
  path: string;
  referrer: string | null;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
  anon: boolean;
};

export async function getRecentVisits(limit = 60): Promise<AdminRecentVisit[]> {
  const db = getDatabase();
  const views = schema.pageViews;
  const users = schema.users;

  const rows = await db
    .select({
      id: views.id,
      path: views.path,
      referrer: views.referrer,
      createdAt: views.createdAt,
      userName: users.name,
      userEmail: users.email,
      userId: views.userId,
    })
    .from(views)
    .leftJoin(users, eq(users.id, views.userId))
    .orderBy(desc(views.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    referrer: row.referrer,
    createdAt: row.createdAt.toISOString(),
    userName: row.userName,
    userEmail: row.userEmail,
    anon: row.userId === null,
  }));
}

export type AdminTopPath = { path: string; views: number };

export async function getTopPaths(
  days = 30,
  limit = 15,
): Promise<AdminTopPath[]> {
  const db = getDatabase();
  const views = schema.pageViews;

  const rows = await db
    .select({
      path: views.path,
      views: sql<number>`count(*)::int`,
    })
    .from(views)
    .where(gte(views.createdAt, since(days * DAY_MS)))
    .groupBy(views.path)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return rows.map((row) => ({ path: row.path, views: row.views ?? 0 }));
}

export type AdminDailyPoint = { day: string; views: number; visitors: number };

export async function getDailyTraffic(days = 30): Promise<AdminDailyPoint[]> {
  const db = getDatabase();
  const views = schema.pageViews;

  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${views.createdAt}), 'YYYY-MM-DD')`,
      views: sql<number>`count(*)::int`,
      visitors: sql<number>`count(distinct coalesce(${views.userId}::text, ${views.ipHash}))::int`,
    })
    .from(views)
    .where(gte(views.createdAt, since(days * DAY_MS)))
    .groupBy(sql`date_trunc('day', ${views.createdAt})`)
    .orderBy(sql`date_trunc('day', ${views.createdAt})`);

  return rows.map((row) => ({
    day: row.day,
    views: row.views ?? 0,
    visitors: row.visitors ?? 0,
  }));
}
