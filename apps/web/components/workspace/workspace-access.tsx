"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Member {
  userId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  role: "owner" | "member";
  canTerminal: boolean;
  canMerge: boolean;
}

export function WorkspaceAccess({
  workspaceId,
  members,
  isOwner,
}: {
  workspaceId: string;
  members: Member[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [inviteUrl, setInviteUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function createInvite() {
    setBusy("invite");
    setMessage("");
    const response = await fetch(`/api/workspaces/${workspaceId}/invites`, {
      method: "POST",
    });
    const payload = (await response.json()) as {
      inviteUrl?: string;
      error?: string;
    };
    if (!response.ok || !payload.inviteUrl) {
      setMessage(payload.error ?? "The invite could not be created.");
    } else {
      setInviteUrl(payload.inviteUrl);
      setMessage("Invite ready. It expires in 24 hours and can be used once.");
    }
    setBusy("");
  }

  async function updateMember(
    member: Member,
    field: "canTerminal" | "canMerge",
    value: boolean,
  ) {
    setBusy(`${member.userId}-${field}`);
    setMessage("");
    const response = await fetch(
      `/api/workspaces/${workspaceId}/members/${member.userId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canTerminal: field === "canTerminal" ? value : member.canTerminal,
          canMerge: field === "canMerge" ? value : member.canMerge,
        }),
      },
    );
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setMessage(payload.error ?? "Capabilities could not be updated.");
    } else {
      router.refresh();
    }
    setBusy("");
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setMessage("Invite link copied.");
  }

  return (
    <section className="panel access-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">People and permissions</p>
          <h2>Workspace access</h2>
        </div>
        {isOwner ? (
          <button
            className="secondary-button"
            type="button"
            disabled={busy === "invite"}
            onClick={() => void createInvite()}
          >
            {busy === "invite" ? "Creating…" : "Create invite"}
          </button>
        ) : null}
      </div>

      {inviteUrl ? (
        <div className="invite-result">
          <code>{inviteUrl}</code>
          <button type="button" onClick={() => void copyInvite()}>
            Copy
          </button>
        </div>
      ) : null}

      <div className="member-table" role="table" aria-label="Workspace members">
        <div className="member-row member-header" role="row">
          <span>Member</span>
          <span>Role</span>
          <span>Terminal</span>
          <span>Merge</span>
        </div>
        {members.map((member) => (
          <div className="member-row" role="row" key={member.userId}>
            <div className="member-identity">
              <span className="member-avatar" aria-hidden="true">
                {member.login.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{member.name ?? member.login}</strong>
                <small>@{member.login}</small>
              </span>
            </div>
            <span className="role-label">{member.role}</span>
            {(["canTerminal", "canMerge"] as const).map((field) => (
              <label className="capability-toggle" key={field}>
                <input
                  type="checkbox"
                  checked={member[field]}
                  disabled={
                    !isOwner ||
                    member.role === "owner" ||
                    busy === `${member.userId}-${field}`
                  }
                  onChange={(event) =>
                    void updateMember(member, field, event.target.checked)
                  }
                />
                <span>{member[field] ? "Allowed" : "Off"}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}
