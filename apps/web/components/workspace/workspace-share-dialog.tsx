"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type InviteAccessRole = "co_steer" | "reviewer" | "viewer";
type MemberAccessRole = "owner" | InviteAccessRole;

type Invite = {
  inviteId: string;
  accessRole: InviteAccessRole;
  invitee: string | null;
  allowLink: boolean;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired";
};

type Member = {
  userId: string;
  login: string;
  name: string | null;
  role: "owner" | "member";
  accessRole: MemberAccessRole;
};

type LoadState = "loading" | "ready" | "error";

const ROLE_LABEL: Record<MemberAccessRole, string> = {
  owner: "Owner",
  co_steer: "Co-steer",
  reviewer: "Reviewer",
  viewer: "Viewer",
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "The request failed.");
  }
  return payload;
}

export function WorkspaceShareDialog({
  workspaceId,
  canInvite,
  open,
  onClose,
}: {
  workspaceId: string;
  canInvite: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<InviteAccessRole>("co_steer");
  const [newInviteUrl, setNewInviteUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setState("loading");
      setMessage("");
      try {
        const payload = await readJson<{
          invites: Invite[];
          members: Member[];
        }>(
          await fetch(`/api/workspaces/${workspaceId}/invites`, {
            signal: controller.signal,
          }),
        );
        if (controller.signal.aborted) return;
        setInvites(payload.invites);
        setMembers(payload.members);
        setState("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setMessage(
          error instanceof Error ? error.message : "The request failed.",
        );
        setState("error");
      }
    })();
    return () => controller.abort();
  }, [open, workspaceId]);

  async function createInvite() {
    setCreating(true);
    setMessage("");
    try {
      const payload = await readJson<{
        inviteUrl: string;
        invites: Invite[];
        members: Member[];
      }>(
        await fetch(`/api/workspaces/${workspaceId}/invites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessRole: role, allowLink: true }),
        }),
      );
      setNewInviteUrl(payload.inviteUrl);
      setInvites(payload.invites);
      setMembers(payload.members);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The invite could not be created.",
      );
    }
    setCreating(false);
  }

  async function revokeInvite(inviteId: string) {
    setRevokingId(inviteId);
    setMessage("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/invites/${inviteId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "The invite could not be revoked.");
      }
      setInvites((current) =>
        current.filter((invite) => invite.inviteId !== inviteId),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The invite could not be revoked.",
      );
    }
    setRevokingId("");
  }

  async function copyInviteUrl() {
    await navigator.clipboard.writeText(newInviteUrl);
    setMessage("Invite link copied.");
  }

  if (!open) return null;

  const pendingInvites = invites.filter(
    (invite) => invite.status === "pending",
  );

  return (
    <div
      className="workspace-create-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="workspace-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-share-title"
      >
        <div className="workspace-create-heading">
          <div>
            <p className="eyebrow">Share workspace</p>
            <h2 id="workspace-share-title">People with access</h2>
            <p>
              Invite links expire in 24 hours and can be used once. Anyone with
              the link can join at the role you choose.
            </p>
          </div>
          <button
            className="modal-close-button"
            type="button"
            aria-label="Close share dialog"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {canInvite ? (
          <div className="picker-grid">
            <label>
              <span>New invite role</span>
              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as InviteAccessRole)
                }
                disabled={creating}
              >
                <option value="co_steer">Co-steer</option>
                <option value="reviewer">Reviewer</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <button
              className="primary-button picker-submit"
              type="button"
              disabled={creating}
              onClick={() => void createInvite()}
            >
              {creating ? "Creating…" : "Create invite link"}
            </button>
          </div>
        ) : null}

        {newInviteUrl ? (
          <div className="invite-result">
            <code>{newInviteUrl}</code>
            <button type="button" onClick={() => void copyInviteUrl()}>
              Copy
            </button>
          </div>
        ) : null}

        {message ? (
          <p
            className={`panel-status ${state === "error" ? "error-copy" : ""}`}
          >
            {message}
          </p>
        ) : null}

        {state === "loading" ? (
          <p className="panel-status">Loading workspace access…</p>
        ) : null}

        {state === "ready" && pendingInvites.length > 0 ? (
          <div className="member-table">
            <div className="member-header" role="row">
              Pending invite links
            </div>
            {pendingInvites.map((invite) => (
              <div className="share-row" key={invite.inviteId}>
                <span>
                  <strong>{invite.invitee ?? "Anyone with the link"}</strong>
                  <small>
                    {" "}
                    · expires {new Date(invite.expiresAt).toLocaleString()}
                  </small>
                </span>
                <span className="role-label">
                  {ROLE_LABEL[invite.accessRole]}
                </span>
                {canInvite ? (
                  <button
                    type="button"
                    disabled={revokingId === invite.inviteId}
                    onClick={() => void revokeInvite(invite.inviteId)}
                  >
                    {revokingId === invite.inviteId ? "Revoking…" : "Revoke"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {state === "ready" ? (
          <div className="member-table">
            <div className="member-header" role="row">
              Members
            </div>
            {members.map((member) => (
              <div className="share-row" key={member.userId}>
                <span className="member-identity">
                  <span className="member-avatar" aria-hidden="true">
                    {member.login.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{member.name ?? member.login}</strong>
                    <small> @{member.login}</small>
                  </span>
                </span>
                <span className="role-label">
                  {ROLE_LABEL[member.accessRole]}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
