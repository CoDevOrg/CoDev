"use client";

import { useState } from "react";
import { Check, Copy, Link2, Trash2, X } from "lucide-react";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

type PendingAction =
  | { kind: "role"; userId: string }
  | { kind: "remove"; userId: string }
  | { kind: "invite" }
  | { kind: "revoke" }
  | null;

function memberName(member: Gen2WorkspaceDetail["members"][number]) {
  return member.name || member.login;
}

export function Gen2WorkspaceAccessPanel({
  onClose,
  onWorkspaceChange,
  workspace,
}: {
  onClose: () => void;
  onWorkspaceChange: (workspace: Gen2WorkspaceDetail) => void;
  workspace: Gen2WorkspaceDetail;
}) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [confirmRemoval, setConfirmRemoval] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const canInvite = workspace.capabilities["member.invite"];
  const canChangeRole = workspace.capabilities["member.changeRole"];
  const canRemove = workspace.capabilities["member.remove"];

  async function refreshWorkspace() {
    const response = await fetch(`/api/gen2/workspaces/${workspace.id}`);
    const payload = (await response.json().catch(() => ({}))) as {
      workspace?: Gen2WorkspaceDetail;
      error?: string;
    };
    if (!response.ok || !payload.workspace) {
      throw new Error(payload.error ?? "Could not refresh workspace access.");
    }
    onWorkspaceChange(payload.workspace);
  }

  async function createInvite() {
    setPending({ kind: "invite" });
    setError("");
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${workspace.id}/share`,
        {
          method: "POST",
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        inviteUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.inviteUrl) {
        throw new Error(payload.error ?? "Could not create an invite link.");
      }
      setInviteUrl(payload.inviteUrl);
      await navigator.clipboard.writeText(payload.inviteUrl).catch(() => {});
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_500);
      await refreshWorkspace();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create an invite link.",
      );
    } finally {
      setPending(null);
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_500);
  }

  async function revokeInvite() {
    setPending({ kind: "revoke" });
    setError("");
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${workspace.id}/share`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not revoke the invite link.");
      }
      setInviteUrl("");
      setConfirmRevoke(false);
      await refreshWorkspace();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not revoke the invite link.",
      );
    } finally {
      setPending(null);
    }
  }

  async function changeRole(userId: string, role: "editor" | "viewer") {
    setPending({ kind: "role", userId });
    setError("");
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${workspace.id}/members/${userId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not update this role.");
      }
      onWorkspaceChange({
        ...workspace,
        members: workspace.members.map((member) =>
          member.userId === userId ? { ...member, role } : member,
        ),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update this role.",
      );
    } finally {
      setPending(null);
    }
  }

  async function removeMember(userId: string) {
    setPending({ kind: "remove", userId });
    setError("");
    try {
      const response = await fetch(
        `/api/gen2/workspaces/${workspace.id}/members/${userId}`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not remove this member.");
      }
      onWorkspaceChange({
        ...workspace,
        members: workspace.members.filter((member) => member.userId !== userId),
      });
      setConfirmRemoval(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not remove this member.",
      );
    } finally {
      setPending(null);
    }
  }

  const inviteIsActive = workspace.activeInvite?.active ?? false;

  return (
    <section
      className="gen2-access"
      id="gen2-access-panel"
      aria-labelledby="gen2-access-title"
    >
      <div className="gen2-access-header">
        <div>
          <h2 id="gen2-access-title">Members &amp; access</h2>
          <p>
            People in this workspace share its files, terminal, and chat
            context.
          </p>
        </div>
        <button
          aria-label="Close members and access"
          className="gen2-access-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </div>

      {error ? (
        <p className="gen2-access-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="gen2-access-grid">
        <div className="gen2-access-section">
          <div className="gen2-access-section-heading">
            <h3>People</h3>
            <span>{workspace.members.length}</span>
          </div>
          <ul className="gen2-access-members">
            {workspace.members.map((member) => {
              const isOwner = member.role === "owner";
              const rolePending =
                pending?.kind === "role" && pending.userId === member.userId;
              const removalPending =
                pending?.kind === "remove" && pending.userId === member.userId;
              const removeConfirmation = confirmRemoval === member.userId;
              return (
                <li key={member.userId}>
                  <div className="gen2-access-avatar" aria-hidden="true">
                    {memberName(member).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="gen2-access-member-name">
                    <strong>{memberName(member)}</strong>
                    <span>@{member.login}</span>
                  </div>
                  {isOwner || !canChangeRole ? (
                    <span className="gen2-access-role">{member.role}</span>
                  ) : (
                    <label className="gen2-access-role-select">
                      <span className="gen2-visually-hidden">
                        Role for {memberName(member)}
                      </span>
                      <select
                        aria-label={`Role for ${memberName(member)}`}
                        disabled={rolePending}
                        onChange={(event) =>
                          void changeRole(
                            member.userId,
                            event.target.value as "editor" | "viewer",
                          )
                        }
                        value={member.role}
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </label>
                  )}
                  {canRemove && !isOwner ? (
                    <button
                      aria-label={`Remove ${memberName(member)}`}
                      className="gen2-access-remove"
                      disabled={removalPending}
                      onClick={() => setConfirmRemoval(member.userId)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                    </button>
                  ) : null}
                  {removeConfirmation ? (
                    <div className="gen2-access-confirm">
                      <p>
                        Remove {memberName(member)}? They will lose access
                        immediately.
                      </p>
                      <div>
                        <button
                          className="gen2-wb-button"
                          disabled={removalPending}
                          onClick={() => setConfirmRemoval(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="gen2-access-danger"
                          disabled={removalPending}
                          onClick={() => void removeMember(member.userId)}
                          type="button"
                        >
                          {removalPending ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        {canInvite ? (
          <div className="gen2-access-section">
            <div className="gen2-access-section-heading">
              <h3>Invite link</h3>
              <span>{inviteIsActive ? "Active" : "Inactive"}</span>
            </div>
            <p className="gen2-access-note">
              Anyone with this link joins as an editor. It expires after seven
              days.
            </p>
            {inviteUrl ? (
              <div className="gen2-access-link">
                <input aria-label="Invite link" readOnly value={inviteUrl} />
                <button
                  className="gen2-wb-button"
                  onClick={() => void copyInvite()}
                  type="button"
                >
                  {copied ? (
                    <>
                      <Check aria-hidden="true" size={14} /> Copied
                    </>
                  ) : (
                    <>
                      <Copy aria-hidden="true" size={14} /> Copy
                    </>
                  )}
                </button>
              </div>
            ) : null}
            <div className="gen2-access-actions">
              <button
                className="gen2-wb-button"
                disabled={pending?.kind === "invite"}
                onClick={() => void createInvite()}
                type="button"
              >
                <Link2 aria-hidden="true" size={14} />
                {pending?.kind === "invite"
                  ? "Creating…"
                  : inviteIsActive
                    ? "Rotate link"
                    : "Create link"}
              </button>
              {inviteIsActive && !confirmRevoke ? (
                <button
                  className="gen2-access-text-danger"
                  onClick={() => setConfirmRevoke(true)}
                  type="button"
                >
                  Revoke link
                </button>
              ) : null}
            </div>
            {confirmRevoke ? (
              <div className="gen2-access-confirm">
                <p>
                  Revoke this link? People who already joined keep their access.
                </p>
                <div>
                  <button
                    className="gen2-wb-button"
                    disabled={pending?.kind === "revoke"}
                    onClick={() => setConfirmRevoke(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="gen2-access-danger"
                    disabled={pending?.kind === "revoke"}
                    onClick={() => void revokeInvite()}
                    type="button"
                  >
                    {pending?.kind === "revoke" ? "Revoking…" : "Revoke link"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
