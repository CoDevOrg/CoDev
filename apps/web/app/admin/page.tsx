import type { Metadata } from "next";
import Image from "next/image";

import "./admin.css";

import { AdminWaitlist } from "@/components/admin-waitlist";
import { AppChrome } from "@/components/app-chrome";
import { listAccessRequests } from "@/lib/access-requests";
import { requireAdmin } from "@/lib/admin";
import {
  getAdminSummary,
  getDailyTraffic,
  getRecentVisits,
  getTopPaths,
  getUserDirectory,
} from "@/lib/admin-stats";
import { listAllWorkspacesForAdmin } from "@/lib/admin-workspaces";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

const numberFmt = new Intl.NumberFormat("en-US");
const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return usdFmt.format(value);
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${numberFmt.format(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${numberFmt.format(hours)}h ${rest}m`;
}

const ACCESS_ROLE_LABEL: Record<string, string> = {
  owner: "owner",
  co_steer: "co-steer",
  reviewer: "reviewer",
  viewer: "viewer",
};

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

  const [summary, directory, recentVisits, topPaths, daily, waitlist, workspacesReport] =
    await Promise.all([
      getAdminSummary(),
      getUserDirectory(),
      getRecentVisits(60),
      getTopPaths(30, 15),
      getDailyTraffic(30),
      listAccessRequests(),
      listAllWorkspacesForAdmin(),
    ]);

  const waitlistPending = waitlist.filter(
    (row) => row.status === "pending",
  ).length;

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
          <h2>
            Waitlist ({waitlist.length})
            {waitlistPending ? (
              <span
                className="admin-badge status-pending"
                style={{ marginLeft: "0.5rem" }}
              >
                {waitlistPending} pending
              </span>
            ) : null}
          </h2>
          <p className="admin-console-sub" style={{ marginBottom: "1rem" }}>
            Account creation is invite-only. &ldquo;Invite&rdquo; emails a
            single-use link that lets that person sign up with any provider.
          </p>
          <AdminWaitlist rows={waitlist} />
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

        <section className="admin-section">
          <h2>Workspaces ({workspacesReport.workspaces.length})</h2>
          <p className="admin-console-sub" style={{ marginBottom: "1rem" }}>
            Every workspace ever created, including closed ones — closing a
            workspace marks it deleted but keeps its record here permanently.
            Cost is real AWS spend (Cost Explorer, the{" "}
            <code>Project=CoDev</code> tag), not an estimate — but it has only
            been tracked since{" "}
            {formatDate(workspacesReport.costTracking.trackedSinceIso)}, since
            that&rsquo;s when the tag was activated; AWS cannot retroactively
            reconstruct tagged spend from before that date. Per-workspace
            dollars are this workspace&rsquo;s share of the real{" "}
            {formatUsd(workspacesReport.costTracking.attributableEc2Usd)} EC2
            bill, split by its real recorded runtime minutes — the only slice
            that can be honestly attributed to one workspace, since every
            workspace shares one host. The remaining{" "}
            {formatUsd(workspacesReport.costTracking.platformOverheadUsd)}{" "}
            of real spend (networking, KMS, storage, tax) is shared platform
            overhead with no honest per-workspace split, so it isn&rsquo;t
            divided below.
          </p>
          <div className="admin-stat-grid" style={{ marginBottom: "1rem" }}>
            <div className="admin-stat">
              <div className="admin-stat-label">Real AWS spend tracked</div>
              <div className="admin-stat-value">
                {formatUsd(workspacesReport.costTracking.totalRealSpendUsd)}
              </div>
              <div className="admin-stat-hint">
                since {formatDate(workspacesReport.costTracking.trackedSinceIso)}
              </div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat-label">
                Attributable to workspaces (EC2)
              </div>
              <div className="admin-stat-value">
                {formatUsd(workspacesReport.costTracking.attributableEc2Usd)}
              </div>
              <div className="admin-stat-hint">
                split by real recorded runtime minutes
              </div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat-label">Platform overhead</div>
              <div className="admin-stat-value">
                {formatUsd(workspacesReport.costTracking.platformOverheadUsd)}
              </div>
              <div className="admin-stat-hint">
                networking, KMS, storage, tax — not per-workspace
              </div>
            </div>
          </div>
          <div className="admin-table-wrap">
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Workspace</th>
                    <th>Owner</th>
                    <th>Members</th>
                    <th className="num">Tracked runtime</th>
                    <th className="num">Est. cost</th>
                    <th>Created</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {workspacesReport.workspaces.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="admin-muted">
                        No workspaces yet.
                      </td>
                    </tr>
                  ) : (
                    workspacesReport.workspaces.map((workspace) => (
                      <tr key={workspace.id}>
                        <td>
                          <span className="admin-user-name">
                            {workspace.repository}
                          </span>
                          <br />
                          <span className="admin-user-login">
                            {workspace.defaultBranch}
                          </span>
                        </td>
                        <td>
                          {workspace.ownerName ?? workspace.ownerLogin}
                          <br />
                          <span className="admin-user-login">
                            @{workspace.ownerLogin}
                          </span>
                        </td>
                        <td>
                          {workspace.members.length === 0 ? (
                            <span className="admin-muted">—</span>
                          ) : (
                            <span className="admin-providers">
                              {workspace.members.map((member) => (
                                <span
                                  className="admin-chip"
                                  key={member.userId}
                                  title={member.name ?? member.login}
                                >
                                  @{member.login} ·{" "}
                                  {ACCESS_ROLE_LABEL[member.accessRole] ??
                                    member.accessRole}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="num">
                          {formatMinutes(workspace.trackedMinutes)}
                        </td>
                        <td className="num">
                          {formatUsd(workspace.estimatedCostUsd)}
                        </td>
                        <td className="admin-time">
                          {formatDate(workspace.createdAt)}
                        </td>
                        <td>
                          {workspace.isDeleted ? (
                            <span className="admin-badge status-declined">
                              deleted {formatDate(workspace.deletedAt!)}
                            </span>
                          ) : (
                            <span className="admin-badge status-accepted">
                              {workspace.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
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
