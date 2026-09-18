"use client";

import { useState } from "react";

import {
  workspaceRoleCapabilities,
  type WorkspaceRole,
} from "@codev/contracts";

import styles from "@/app/verification/b0-2/fixture.module.css";

const member = {
  name: "Jordan Lee",
  email: "jordan.collaborator@example.test",
};

const roleOptions: Array<{ value: WorkspaceRole; label: string }> = [
  { value: "collaborator", label: "Collaborator" },
  { value: "viewer", label: "Viewer" },
];

export function MemberRoleManagementFixture() {
  const [role, setRole] = useState<WorkspaceRole>("collaborator");
  const capabilities = workspaceRoleCapabilities[role];
  const isRefreshed = role === "viewer";

  return (
    <section
      className={`${styles.card} ${styles.roleManagement}`}
      aria-labelledby="role-management-heading"
    >
      <div className={styles.cardHeading}>
        <div>
          <span className={styles.kicker}>F1.4 · live membership</span>
          <h2 id="role-management-heading">Manage member role</h2>
        </div>
        <span className={styles.count}>{isRefreshed ? "Live" : "Role"}</span>
      </div>

      <div className={styles.memberRoleEditor}>
        <div className={styles.memberRoleIdentity}>
          <span className={styles.avatar} aria-hidden="true">
            JL
          </span>
          <div>
            <strong>{member.name}</strong>
            <span>{member.email}</span>
          </div>
        </div>
        <label className={styles.roleSelectLabel}>
          <span>Maintainer role control</span>
          <select
            aria-label={`Role for ${member.name}`}
            value={role}
            onChange={(event) => setRole(event.target.value as WorkspaceRole)}
          >
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.liveMemberPanel} aria-label="Live member access">
        <div className={styles.liveMemberHeader}>
          <div>
            <span className={styles.label}>Jordan’s current access</span>
            <strong>
              {roleOptions.find((option) => option.value === role)?.label}
            </strong>
          </div>
          <span
            className={isRefreshed ? styles.liveBadge : styles.pendingBadge}
          >
            {isRefreshed ? "Membership refreshed live" : "Connected"}
          </span>
        </div>
        <div className={styles.permissionList} aria-label="Jordan permissions">
          <span className={styles.permissionAllowed}>
            Inspect workspace ·{" "}
            {capabilities.canView ? "allowed" : "unavailable"}
          </span>
          {[
            ["Edit shared files", capabilities.canEdit],
            ["Run terminal command", capabilities.canWriteTerminal],
            ["Add agent prompt", capabilities.canCoSteer],
            ["Manage members", capabilities.canManageMembers],
          ].map(([label, allowed]) => (
            <button
              type="button"
              disabled={!allowed}
              className={styles.permissionButton}
              key={label as string}
            >
              {label as string} · {allowed ? "allowed" : "unavailable"}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.viewerStatus} role="status">
        {isRefreshed
          ? "Jordan’s Viewer controls updated immediately from the live membership change."
          : "Jordan is connected as a Collaborator. Change the role to see the live refresh."}
      </p>
    </section>
  );
}
