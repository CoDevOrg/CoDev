"use client";

import { useState, useTransition } from "react";

import { declineWaitlistEntry, inviteWaitlistEntry } from "@/app/admin/actions";
import type {
  AccessRequestRow,
  WaitlistActionResult,
} from "@/lib/access-requests";

const numberFmt = new Intl.NumberFormat("en-US");

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type Filter = "all" | "pending" | "invited" | "accepted" | "declined";

export function AdminWaitlist({ rows }: { rows: AccessRequestRow[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<WaitlistActionResult | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [, startTransition] = useTransition();

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const visible =
    filter === "all" ? rows : rows.filter((r) => r.status === filter);

  function run(
    id: string,
    action: (id: string) => Promise<WaitlistActionResult>,
  ) {
    setPendingId(id);
    setNotice(null);
    startTransition(async () => {
      const result = await action(id);
      setNotice(result);
      setPendingId(null);
    });
  }

  const filters: Filter[] = [
    "all",
    "pending",
    "invited",
    "accepted",
    "declined",
  ];

  return (
    <div>
      <div className="admin-waitlist-toolbar">
        {filters.map((value) => (
          <button
            key={value}
            type="button"
            className={`admin-filter${filter === value ? " is-active" : ""}`}
            onClick={() => setFilter(value)}
          >
            {value === "all"
              ? "All"
              : value.charAt(0).toUpperCase() + value.slice(1)}
            {value !== "all" && counts[value]
              ? ` (${numberFmt.format(counts[value])})`
              : ""}
          </button>
        ))}
      </div>

      {notice ? (
        <div
          className={`inline-alert${notice.ok ? "" : " error"}`}
          role="status"
          style={{ marginBottom: "0.9rem" }}
        >
          {notice.message}
        </div>
      ) : null}

      <div className="admin-table-wrap">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Person</th>
                <th>Building</th>
                <th>Status</th>
                <th>Invited</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="admin-muted">
                    Nothing here.
                  </td>
                </tr>
              ) : (
                visible.map((row) => {
                  const busy = pendingId === row.id;
                  const canInvite =
                    row.status === "pending" ||
                    row.status === "declined" ||
                    (row.status === "invited" && row.inviteExpired);
                  return (
                    <tr key={row.id}>
                      <td className="admin-time">
                        {formatDate(row.createdAt)}
                      </td>
                      <td>
                        <span className="admin-user-name">
                          {row.name || "—"}
                        </span>
                        <br />
                        <span className="admin-user-login">{row.email}</span>
                      </td>
                      <td className="admin-muted">
                        {row.persona ? <strong>{row.persona}</strong> : null}
                        {row.persona && row.building ? " · " : null}
                        {row.building ?? (row.persona ? "" : "—")}
                      </td>
                      <td>
                        <span
                          className={`admin-badge status-${row.status}${row.inviteExpired ? " is-expired" : ""}`}
                        >
                          {row.inviteExpired ? "invite expired" : row.status}
                        </span>
                      </td>
                      <td className="admin-time">
                        {formatDate(row.invitedAt)}
                      </td>
                      <td className="admin-actions-cell">
                        {row.status === "accepted" ? (
                          <span className="admin-muted">joined</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="admin-btn primary"
                              disabled={busy}
                              onClick={() => run(row.id, inviteWaitlistEntry)}
                            >
                              {busy
                                ? "…"
                                : canInvite
                                  ? "Invite"
                                  : "Re-send invite"}
                            </button>
                            {row.status !== "declined" ? (
                              <button
                                type="button"
                                className="admin-btn"
                                disabled={busy}
                                onClick={() =>
                                  run(row.id, declineWaitlistEntry)
                                }
                              >
                                Decline
                              </button>
                            ) : null}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
