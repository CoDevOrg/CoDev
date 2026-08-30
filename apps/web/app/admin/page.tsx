import type { Metadata } from "next";
import Image from "next/image";

import "./admin.css";

import { AppChrome } from "@/components/app-chrome";
import { requireAdmin } from "@/lib/admin";
import {
  getAdminSummary,
  getDailyTraffic,
  getRecentVisits,
  getTopPaths,
  getUserDirectory,
} from "@/lib/admin-stats";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

const numberFmt = new Intl.NumberFormat("en-US");

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export default async function AdminPage() {
  const user = await requireAdmin();

  const [summary, directory, recentVisits, topPaths, daily] = await Promise.all(
    [
      getAdminSummary(),
      getUserDirectory(),
      getRecentVisits(60),
      getTopPaths(30, 15),
      getDailyTraffic(30),
    ],
  );

  const maxDaily = Math.max(1, ...daily.map((point) => point.views));

  const stats: { label: string; value: string; hint?: string }[] = [
    {
      label: "Total accounts",
      value: numberFmt.format(summary.totalUsers),
      hint: `+${summary.newUsers7d} this week · +${summary.newUsers30d} this month`,
    },
    {
      label: "Active accounts · now",
      value: numberFmt.format(summary.activeAccounts30m),
      hint: "signed-in, last 30 min",
    },
    {
      label: "Active accounts · 24h",
      value: numberFmt.format(summary.activeAccounts24h),
      hint: `${numberFmt.format(summary.activeAccounts7d)} in last 7 days`,
    },
    {
      label: "Page views · 24h",
      value: numberFmt.format(summary.views24h),
      hint: `${numberFmt.format(summary.views7d)} in 7d · ${numberFmt.format(summary.views30d)} in 30d`,
    },
    {
      label: "Unique visitors · 7d",
      value: numberFmt.format(summary.uniqueVisitors7d),
      hint: "by account or address",
    },
    {
      label: "Page views · all time",
      value: numberFmt.format(summary.totalViews),
    },
  ];

  return (
    <AppChrome user={user} sidebar>
      <div className="admin-console">
        <div className="admin-console-head">
          <h1>Admin console</h1>
          <span className="admin-muted">Signed in as {user.email}</span>
        </div>
        <p className="admin-console-sub">
          User directory and site analytics. Visible only to application
          administrators.
        </p>

        <div className="admin-stat-grid">
          {stats.map((stat) => (
            <div className="admin-stat" key={stat.label}>
              <div className="admin-stat-label">{stat.label}</div>
              <div className="admin-stat-value">{stat.value}</div>
              {stat.hint ? (
                <div className="admin-stat-hint">{stat.hint}</div>
              ) : null}
            </div>
          ))}
        </div>

        <section className="admin-section">
          <h2>Traffic · last 30 days</h2>
          {daily.length === 0 ? (
            <div className="admin-chart">
              <span className="admin-chart-empty">
                No page views recorded yet. Data starts collecting once this
                deploy is live.
              </span>
            </div>
          ) : (
            <div
              className="admin-chart"
              role="img"
              aria-label="Daily page views"
            >
              {daily.map((point) => (
                <div
                  key={point.day}
                  className={`admin-chart-bar${point.views === 0 ? " is-empty" : ""}`}
                  style={{
                    height: `${Math.max(3, Math.round((point.views / maxDaily) * 100))}%`,
                  }}
                  title={`${point.day}: ${point.views} views, ${point.visitors} visitors`}
                />
              ))}
            </div>
          )}
        </section>

        <section className="admin-section">
          <h2>All users ({directory.length})</h2>
          <div className="admin-table-wrap">
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Sign-in</th>
                    <th>Joined</th>
                    <th>Last seen</th>
                    <th className="num">Visits</th>
                  </tr>
                </thead>
                <tbody>
                  {directory.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-user-cell">
                          {row.avatarUrl ? (
                            <Image
                              className="admin-avatar"
                              src={row.avatarUrl}
                              alt=""
                              width={26}
                              height={26}
                              unoptimized
                            />
                          ) : (
                            <span className="admin-avatar" aria-hidden="true" />
                          )}
                          <span>
                            <span className="admin-user-name">
                              {row.name ?? row.login}
                            </span>
                            {row.isAdmin ? (
                              <span className="admin-badge is-admin">
                                admin
                              </span>
                            ) : null}
                            <br />
                            <span className="admin-user-login">
                              @{row.login}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>
                        {row.email ?? <span className="admin-muted">—</span>}
                      </td>
                      <td>
                        <span className="admin-providers">
                          {row.hasGithub ? (
                            <span className="admin-chip">GitHub</span>
                          ) : null}
                          {row.hasGoogle ? (
                            <span className="admin-chip">Google</span>
                          ) : null}
                          {row.hasPassword ? (
                            <span className="admin-chip">Password</span>
                          ) : null}
                          {!row.hasGithub &&
                          !row.hasGoogle &&
                          !row.hasPassword ? (
                            <span className="admin-muted">—</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="admin-time">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="admin-time">
                        {formatRelative(row.lastSeenAt)}
                      </td>
                      <td className="num">{numberFmt.format(row.visits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div className="admin-two-col">
          <section className="admin-section">
            <h2>Top pages · 30d</h2>
            <div className="admin-table-wrap">
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th className="num">Views</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topPaths.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="admin-muted">
                          No data yet.
                        </td>
                      </tr>
                    ) : (
                      topPaths.map((row) => (
                        <tr key={row.path}>
                          <td className="admin-path">{row.path}</td>
                          <td className="num">{numberFmt.format(row.views)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="admin-section">
            <h2>Recent visits</h2>
            <div className="admin-table-wrap">
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentVisits.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="admin-muted">
                          No visits recorded yet.
                        </td>
                      </tr>
                    ) : (
                      recentVisits.map((row) => (
                        <tr key={row.id}>
                          <td className="admin-time">
                            {formatRelative(row.createdAt)}
                          </td>
                          <td>
                            {row.anon ? (
                              <span className="admin-muted">anonymous</span>
                            ) : (
                              (row.userName ?? row.userEmail ?? "account")
                            )}
                          </td>
                          <td className="admin-path">{row.path}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppChrome>
  );
}
