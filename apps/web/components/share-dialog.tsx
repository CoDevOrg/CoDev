"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { X } from "lucide-react";

type AccessRole = "owner" | "co_steer" | "reviewer" | "viewer";

export type WorkspaceShareMember = {
  userId: string;
  login: string;
  name: string | null;
  role: "owner" | "member";
  accessRole: AccessRole;
};

export function ShareDialog({
  workspaceId,
  workspaceName,
  members,
  canShare,
  isOwner,
  triggerLabel = "Share",
}: {
  workspaceId: string;
  workspaceName: string;
  members: WorkspaceShareMember[];
  canShare: boolean;
  isOwner: boolean;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [invitee, setInvitee] = useState("");
  const [accessRole, setAccessRole] =
    useState<Exclude<AccessRole, "owner">>("co_steer");
  const [inviteUrl, setInviteUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [updatingMember, setUpdatingMember] = useState("");

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!canShare) return null;

  async function createInvite(allowLink: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invitee: allowLink ? undefined : invitee,
          accessRole: isOwner ? accessRole : "viewer",
          allowLink,
        }),
      });
      const payload = (await response.json()) as {
        inviteUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.inviteUrl) {
        setMessage(payload.error ?? "The invitation could not be created.");
        return;
      }
      setInviteUrl(payload.inviteUrl);
      setMessage(
        allowLink
          ? "Link ready. It expires in 24 hours and can be used once."
          : "Invitation ready. Share the link with the intended person.",
      );
      setInvitee("");
    } catch {
      setMessage("The invitation could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(inviteUrl);
    setMessage("Invitation link copied.");
  }

  async function updateMemberRole(memberUserId: string, nextRole: string) {
    setUpdatingMember(memberUserId);
    setMessage("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/members/${memberUserId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessRole: nextRole }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setMessage(payload?.error ?? "The member role could not be updated.");
        return;
      }
      router.refresh();
      setMessage("Member permissions updated.");
    } catch {
      setMessage("The member role could not be updated.");
    } finally {
      setUpdatingMember("");
    }
  }

  return (
    <>
      <button
        className="secondary-button"
        type="button"
        onClick={() => {
          setOpen(true);
          setMessage("");
        }}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div
          className="share-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
          >
            <div className="share-dialog-heading">
              <div>
                <p className="eyebrow">Workspace access</p>
                <h2 id="share-dialog-title">Share {workspaceName}</h2>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <label className="share-dialog-invite">
              <span>Add people or GitHub handles</span>
              <div>
                <input
                  value={invitee}
                  onChange={(event) => setInvitee(event.target.value)}
                  placeholder="alex@company.com or @octocat"
                  autoComplete="off"
                  autoFocus
                />
                <button
                  className="primary-button"
                  type="button"
                  disabled={!invitee.trim() || busy}
                  onClick={() => void createInvite(false)}
                >
                  Invite
                </button>
              </div>
            </label>

            {isOwner ? (
              <label className="share-dialog-role">
                <span>Permission for new invitations</span>
                <select
                  value={accessRole}
                  onChange={(event) =>
                    setAccessRole(event.target.value as typeof accessRole)
                  }
                >
                  <option value="co_steer">
                    Co-Steer · edit and run agents
                  </option>
                  <option value="reviewer">
                    Reviewer · inspect and comment
                  </option>
                  <option value="viewer">Viewer · read-only</option>
                </select>
              </label>
            ) : (
              <p className="share-dialog-policy">
                People you add receive Viewer access. Workspace admins control
                elevated permissions.
              </p>
            )}

            <div className="share-dialog-members">
              <strong>People with access</strong>
              {members.map((member) => (
                <div className="share-dialog-member" key={member.userId}>
                  <span className="member-avatar" aria-hidden="true">
                    {member.login.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{member.name ?? member.login}</strong>
                    <small>@{member.login}</small>
                  </span>
                  {member.role === "owner" || !isOwner ? (
                    <span className="role-label">
                      {member.role === "owner" ? "Owner" : member.accessRole}
                    </span>
                  ) : (
                    <select
                      aria-label={`Permission for ${member.login}`}
                      value={member.accessRole}
                      disabled={updatingMember === member.userId}
                      onChange={(event) =>
                        void updateMemberRole(member.userId, event.target.value)
                      }
                    >
                      <option value="co_steer">Co-Steer</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  )}
                </div>
              ))}
            </div>

            <div className="share-dialog-link">
              <div>
                <strong>Anyone with the link</strong>
                <small>
                  Creates a single-use invitation at the selected role.
                </small>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => void createInvite(true)}
              >
                Create link
              </button>
            </div>

            {inviteUrl ? (
              <div className="invite-result">
                <code>{inviteUrl}</code>
                <button type="button" onClick={() => void copy()}>
                  Copy
                </button>
              </div>
            ) : null}
            {message ? (
              <p className="form-message" role="status" aria-live="polite">
                {message}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
