"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Loader2, X } from "lucide-react";
import type { Gen2WorkspaceMember, Gen2WorkspaceRole } from "@codev/contracts";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useWorkspaceShare } from "./use-workspace-share";
import { WorkspaceButton } from "./workspace-button";
import { WorkspaceShareConfirm } from "./workspace-share-confirm";
import { WorkspaceShareLink } from "./workspace-share-link";
import { WorkspaceShareMembers } from "./workspace-share-members";

export interface WorkspaceShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
  currentUserRole: Gen2WorkspaceRole;
  currentUserId?: string | undefined;
  initialMembers?: Gen2WorkspaceMember[];
  /** Fills the invite field when the dialog opens for this request. */
  initialInvite?: { id: number; emailOrLogin: string } | null | undefined;
}

export function WorkspaceShareDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  currentUserRole,
  currentUserId,
  initialMembers,
  initialInvite,
}: WorkspaceShareDialogProps) {
  const share = useWorkspaceShare({
    workspaceId,
    open,
    canShareLink: currentUserRole !== "viewer",
    initialMembers,
  });
  const [inviteInput, setInviteInput] = useState("");
  const [inviteRole, setInviteRole] = useState<Gen2WorkspaceRole>("editor");
  const [inviting, setInviting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Gen2WorkspaceMember | null>(
    null,
  );
  const [transferTarget, setTransferTarget] =
    useState<Gen2WorkspaceMember | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const membersListRef = useRef<HTMLUListElement | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      share.setNotice(null);
      setInviteInput("");
    }
  }
  const [prefilled, setPrefilled] = useState<number | null>(null);
  if (open && initialInvite && initialInvite.id !== prefilled) {
    setPrefilled(initialInvite.id);
    setInviteInput(initialInvite.emailOrLogin.slice(0, 256));
  }

  const self = share.members.find((member) => member.userId === currentUserId);
  const effectiveRole = self?.role ?? currentUserRole;
  const isOwner = effectiveRole === "owner";
  const canInvite = effectiveRole === "owner" || effectiveRole === "editor";

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const active = document.activeElement;
      if (active instanceof HTMLElement) restoreFocusRef.current = active;
    }
    wasOpenRef.current = open;
  }, [open]);

  async function invite() {
    const emailOrLogin = inviteInput.trim();
    if (!emailOrLogin || inviting || !canInvite) return;
    setInviting(true);
    if (await share.addMember(emailOrLogin, inviteRole)) setInviteInput("");
    setInviting(false);
  }

  const notice = share.notice;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="gen2-workspace-surface gen2-share-dialog sm:max-w-[520px]"
          onCloseAutoFocus={(event) => {
            const target = restoreFocusRef.current;
            restoreFocusRef.current = null;
            if (target && document.contains(target)) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <DialogClose asChild>
            <WorkspaceButton
              size="icon"
              className="gen2-workspace-dialog-close"
              aria-label="Close"
            >
              <X aria-hidden="true" />
            </WorkspaceButton>
          </DialogClose>
          <DialogHeader>
            <DialogTitle>Share “{workspaceName}”</DialogTitle>
            <DialogDescription>
              {canInvite
                ? "Invite people by email or username, or send a link."
                : "See who has access. Only editors and the owner can invite people."}
            </DialogDescription>
          </DialogHeader>

          {canInvite ? (
            <form
              className="gen2-share-invite-row"
              onSubmit={(event) => {
                event.preventDefault();
                void invite();
              }}
            >
              <input
                className="gen2-share-input"
                placeholder="Email or username"
                value={inviteInput}
                onChange={(event) => setInviteInput(event.target.value)}
                disabled={inviting}
                aria-label="Add people by email or username"
                autoComplete="off"
                spellCheck={false}
                maxLength={256}
              />
              <select
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as Gen2WorkspaceRole)
                }
                className="gen2-workspace-select"
                aria-label="Choose invite role"
                disabled={inviting}
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <WorkspaceButton
                type="submit"
                tone="primary"
                disabled={!inviteInput.trim() || inviting}
              >
                {inviting ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                {inviting ? "Inviting…" : "Invite"}
              </WorkspaceButton>
            </form>
          ) : null}

          {notice ? (
            <p
              className="gen2-share-notice"
              data-type={notice.type}
              role={notice.type === "error" ? "alert" : "status"}
            >
              {notice.type === "error" ? (
                <CircleAlert aria-hidden="true" />
              ) : (
                <CircleCheck aria-hidden="true" />
              )}
              <span>{notice.text}</span>
            </p>
          ) : null}

          <section
            className="gen2-share-section"
            aria-labelledby="share-people"
          >
            <h3 id="share-people">People with access</h3>
            <WorkspaceShareMembers
              members={share.members}
              ready={share.membersReady}
              error={share.membersError}
              ownerId={share.ownerId}
              currentUserId={currentUserId}
              isOwner={isOwner}
              updatingUserId={share.updatingUserId}
              listRef={membersListRef}
              onRetry={() => void share.refreshMembers()}
              onRoleChange={(member, role) =>
                void share.updateRole(member.userId, role)
              }
              onTransfer={setTransferTarget}
              onRemove={setRemoveTarget}
            />
          </section>

          <Separator />

          <WorkspaceShareLink
            canShare={canInvite}
            url={share.link.url}
            role={share.link.role}
            loading={share.link.loading}
            error={share.link.error}
            onRoleChange={(role) => void share.changeLinkRole(role)}
            onRetry={() => void share.refreshLink()}
            onCopyFailed={() =>
              share.setNotice({
                text: "Couldn’t copy the link. Select the link and copy it manually.",
                type: "error",
              })
            }
          />
        </DialogContent>
      </Dialog>

      <WorkspaceShareConfirm
        open={removeTarget !== null}
        title="Remove access?"
        description={
          removeTarget
            ? `${removeTarget.name || removeTarget.login} will lose access to this workspace. The current share link also stops working, so it can’t be used to rejoin. Their account is not deleted.`
            : ""
        }
        confirmLabel="Remove access"
        pendingLabel="Removing…"
        onConfirm={() =>
          removeTarget
            ? share.removeMember(removeTarget)
            : Promise.resolve(null)
        }
        onClose={() => setRemoveTarget(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          membersListRef.current?.focus();
        }}
      />

      <WorkspaceShareConfirm
        open={transferTarget !== null}
        title="Transfer ownership?"
        description={
          transferTarget
            ? `${transferTarget.name || transferTarget.login} becomes the owner. You become an editor and can no longer change roles, remove people, or transfer ownership. The current share link stops working.`
            : ""
        }
        confirmLabel="Confirm transfer"
        pendingLabel="Transferring…"
        onConfirm={() =>
          transferTarget
            ? share.transferOwnership(transferTarget)
            : Promise.resolve(null)
        }
        onClose={() => setTransferTarget(null)}
      />
    </>
  );
}
