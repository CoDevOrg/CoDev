"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Trash2, X } from "lucide-react";
import type { Gen2WorkspaceMember, Gen2WorkspaceRole } from "@codev/contracts";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useScrambleText } from "./use-scramble-text";
import { WorkspaceButton } from "./workspace-button";

export interface WorkspaceShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
  currentUserRole: Gen2WorkspaceRole;
  currentUserId?: string;
  initialMembers?: Gen2WorkspaceMember[];
}

type Notice = { text: string; type: "success" | "error" };

function roleLabel(role: Gen2WorkspaceRole) {
  if (role === "owner") return "Owner";
  if (role === "editor") return "Editor";
  return "Viewer";
}

export function WorkspaceShareDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  currentUserRole,
  currentUserId,
  initialMembers,
}: WorkspaceShareDialogProps) {
  const [members, setMembers] = useState<Gen2WorkspaceMember[]>(
    initialMembers ?? [],
  );
  const [membersReady, setMembersReady] = useState(
    initialMembers !== undefined,
  );
  const [membersError, setMembersError] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [inviteRole, setInviteRole] = useState<Gen2WorkspaceRole>("editor");
  const [linkRole, setLinkRole] = useState<Gen2WorkspaceRole>("editor");
  const [inviteUrl, setInviteUrl] = useState("");
  // A regenerated link resolves from scrambled characters; copying uses the real one.
  const shownInviteUrl = useScrambleText(inviteUrl);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Gen2WorkspaceMember | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [transferTarget, setTransferTarget] =
    useState<Gen2WorkspaceMember | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const membersListRef = useRef<HTMLDivElement | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setNotice(null);
      setInviteInput("");
      setCopied(false);
    }
  }

  const self = members.find((member) => member.userId === currentUserId);
  const effectiveRole = self?.role ?? currentUserRole;
  const isOwner = effectiveRole === "owner";
  const canInvite = effectiveRole === "owner" || effectiveRole === "editor";

  const refreshMembers = useCallback(async () => {
    setMembersError("");
    try {
      const res = await fetch(
        `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/members`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        members?: Gen2WorkspaceMember[];
        ownerId?: string;
        error?: string;
      };
      if (!res.ok || !data.members) {
        setMembersError(data.error ?? "Couldn’t load people with access.");
        return false;
      }
      setMembers(data.members);
      if (data.ownerId) setOwnerId(data.ownerId);
      setMembersReady(true);
      return true;
    } catch {
      setMembersError("Couldn’t reach CoDev to load people with access.");
      return false;
    }
  }, [workspaceId]);

  const refreshShareLink = useCallback(
    async (targetRole?: Gen2WorkspaceRole) => {
      setLinkLoading(true);
      setLinkError("");
      try {
        const res = await fetch(
          `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/share`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(targetRole ? { role: targetRole } : {}),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          inviteUrl?: string;
          role?: Gen2WorkspaceRole;
          error?: string;
        };
        if (!res.ok || !data.inviteUrl) {
          setLinkError(data.error ?? "Couldn’t create a share link.");
          return false;
        }
        setInviteUrl(data.inviteUrl);
        if (data.role) setLinkRole(data.role);
        return true;
      } catch {
        setLinkError("Couldn’t reach CoDev to create a share link.");
        return false;
      } finally {
        setLinkLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const active = document.activeElement;
      if (active instanceof HTMLElement) restoreFocusRef.current = active;
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      void refreshMembers();
      if (currentUserRole !== "viewer") void refreshShareLink();
    }, 0);
    return () => clearTimeout(timeout);
  }, [open, currentUserRole, refreshMembers, refreshShareLink]);

  const handleAddMember = async () => {
    const emailOrLogin = inviteInput.trim();
    if (!emailOrLogin || submitting || !canInvite) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/members`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ emailOrLogin, role: inviteRole }),
        },
      );
      const data = (await res.json()) as {
        members?: Gen2WorkspaceMember[];
        error?: string;
      };
      if (!res.ok || !data.members) {
        setNotice({
          text: data.error ?? "Couldn’t add this person.",
          type: "error",
        });
      } else {
        setMembers(data.members);
        setMembersReady(true);
        setInviteInput("");
        setNotice({
          text: `Added ${emailOrLogin} as ${inviteRole}.`,
          type: "success",
        });
      }
    } catch {
      setNotice({
        text: "Couldn’t reach CoDev to add this person.",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateRole = async (
    targetUserId: string,
    newRole: Gen2WorkspaceRole,
  ) => {
    setUpdatingUserId(targetUserId);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(targetUserId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        },
      );
      const data = (await res.json()) as {
        members?: Gen2WorkspaceMember[];
        error?: string;
      };
      if (res.ok && data.members) {
        setMembers(data.members);
        setNotice({
          text: `Updated role to ${newRole}.`,
          type: "success",
        });
      } else {
        setNotice({
          text: data.error ?? "Couldn’t update that role.",
          type: "error",
        });
      }
    } catch {
      setNotice({
        text: "Couldn’t reach CoDev to update that role.",
        type: "error",
      });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const confirmRemove = async () => {
    const target = removeTarget;
    if (!target || removing) return;
    setRemoving(true);
    setRemoveError("");
    try {
      const res = await fetch(
        `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(target.userId)}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as {
        members?: Gen2WorkspaceMember[];
        error?: string;
      };
      if (res.ok && data.members) {
        setMembers(data.members);
        setRemoveTarget(null);
        setNotice({ text: "Removed member access.", type: "success" });
      } else {
        setRemoveError(data.error ?? "Couldn’t remove this person.");
      }
    } catch {
      setRemoveError("Couldn’t reach CoDev to remove this person.");
    } finally {
      setRemoving(false);
    }
  };

  const confirmTransfer = async () => {
    const target = transferTarget;
    if (!target || transferring) return;
    setTransferring(true);
    setTransferError("");
    try {
      const res = await fetch(
        `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(target.userId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "owner" }),
        },
      );
      const data = (await res.json()) as {
        members?: Gen2WorkspaceMember[];
        error?: string;
      };
      if (res.ok && data.members) {
        setMembers(data.members);
        setOwnerId(target.userId);
        setTransferTarget(null);
        setNotice({
          text: `Ownership transferred to ${target.name || target.login}. You are now an editor.`,
          type: "success",
        });
      } else {
        setTransferError(data.error ?? "Couldn’t transfer ownership.");
      }
    } catch {
      setTransferError("Couldn’t reach CoDev to transfer ownership.");
    } finally {
      setTransferring(false);
    }
  };

  const handleLinkRoleChange = async (newRole: Gen2WorkspaceRole) => {
    const previous = linkRole;
    setLinkRole(newRole);
    setNotice(null);
    const ok = await refreshShareLink(newRole);
    if (!ok) {
      setLinkRole(previous);
      return;
    }
    setNotice({
      text: `Share link now invites people as ${newRole}.`,
      type: "success",
    });
  };

  const handleCopyLink = async () => {
    if (!inviteUrl || linkLoading) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setNotice(null);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      setNotice({
        text: "Couldn’t copy the link. Select the link and copy it manually.",
        type: "error",
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="gen2-workspace-surface sm:max-w-[540px]"
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
            <DialogTitle>Share &quot;{workspaceName}&quot;</DialogTitle>
            <DialogDescription>
              Adding a person grants access now. A share link only works after
              someone opens it. Changing editor or viewer access does not
              transfer ownership.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="workspace-share-invite">
                Add people
              </FieldLabel>
              <FieldDescription>
                Grants access immediately to an existing CoDev account.
              </FieldDescription>
              <div className="gen2-share-invite-row">
                <Input
                  id="workspace-share-invite"
                  placeholder="Email or username"
                  value={inviteInput}
                  onChange={(event) => setInviteInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleAddMember();
                    }
                  }}
                  disabled={!canInvite || submitting}
                  aria-label="Add people by email or username"
                />
                <select
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as Gen2WorkspaceRole)
                  }
                  className="gen2-workspace-select"
                  aria-label="Choose invite role"
                  disabled={!canInvite || submitting}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <WorkspaceButton
                  onClick={() => void handleAddMember()}
                  disabled={!canInvite || !inviteInput.trim() || submitting}
                  tone="primary"
                >
                  {submitting ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : null}
                  {submitting ? "Inviting…" : "Invite"}
                </WorkspaceButton>
              </div>
              {!canInvite ? (
                <FieldDescription>
                  Viewers can see who has access. Editors and the owner can add
                  people.
                </FieldDescription>
              ) : null}
            </Field>
          </FieldGroup>

          {notice ? (
            <Alert
              variant={notice.type === "error" ? "destructive" : "default"}
            >
              <AlertTitle>
                {notice.type === "error" ? "Couldn’t finish" : "Saved"}
              </AlertTitle>
              <AlertDescription>{notice.text}</AlertDescription>
            </Alert>
          ) : null}

          <Separator />

          <section
            className="gen2-share-section"
            aria-labelledby="share-people"
          >
            <div className="gen2-share-section-heading">
              <h3 id="share-people">People with access</h3>
              <Badge variant="secondary">
                {membersReady
                  ? `${members.length} ${members.length === 1 ? "person" : "people"}`
                  : "Loading"}
              </Badge>
            </div>
            <p className="gen2-share-section-copy">
              Editor and viewer changes apply to someone who already has access.
              Transfer ownership is a separate confirmation.
            </p>
            {membersError ? (
              <Alert variant="destructive">
                <AlertTitle>People list unavailable</AlertTitle>
                <AlertDescription>{membersError}</AlertDescription>
                <WorkspaceButton
                  tone="secondary"
                  type="button"
                  onClick={() => void refreshMembers()}
                >
                  Retry
                </WorkspaceButton>
              </Alert>
            ) : null}
            {!membersReady && !membersError ? (
              <div className="gen2-share-skeletons" aria-hidden="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : null}
            {membersReady && members.length === 0 && !membersError ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No one else has access</EmptyTitle>
                  <EmptyDescription>
                    Add a person above, or copy a share link.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
            {members.length > 0 ? (
              <div
                ref={membersListRef}
                tabIndex={-1}
                className="gen2-share-members"
              >
                {members.map((member) => {
                  const isCurrentUser =
                    currentUserId !== undefined &&
                    member.userId === currentUserId;
                  const isMemberOwner =
                    member.role === "owner" || member.userId === ownerId;
                  const rolePending = updatingUserId === member.userId;
                  return (
                    <div key={member.userId} className="gen2-share-member">
                      <div className="gen2-share-member-identity">
                        <Avatar>
                          <AvatarImage
                            src={member.avatarUrl ?? undefined}
                            alt={member.name || member.login}
                          />
                          <AvatarFallback>
                            {(member.name || member.login)
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="gen2-share-member-name">
                          <span>
                            {member.name || member.login}{" "}
                            {isCurrentUser ? (
                              <span className="gen2-share-you">(you)</span>
                            ) : null}
                          </span>
                          <span>{member.email || member.login}</span>
                        </div>
                      </div>
                      <div className="gen2-share-member-actions">
                        {isOwner && !isCurrentUser && !isMemberOwner ? (
                          <>
                            <select
                              value={
                                member.role === "owner" ? "editor" : member.role
                              }
                              onChange={(event) =>
                                void handleUpdateRole(
                                  member.userId,
                                  event.target.value as Gen2WorkspaceRole,
                                )
                              }
                              className="gen2-workspace-select"
                              aria-label={`Change role for ${member.login}`}
                              disabled={rolePending}
                            >
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                            <WorkspaceButton
                              type="button"
                              onClick={() => {
                                setTransferError("");
                                setTransferTarget(member);
                              }}
                              disabled={rolePending || transferring}
                            >
                              Transfer ownership
                            </WorkspaceButton>
                            <WorkspaceButton
                              size="icon"
                              type="button"
                              tone="destructive"
                              onClick={() => {
                                setRemoveError("");
                                setRemoveTarget(member);
                              }}
                              aria-label={`Remove access for ${member.login}`}
                              disabled={removing}
                            >
                              <Trash2 aria-hidden="true" />
                            </WorkspaceButton>
                          </>
                        ) : (
                          <Badge variant="outline">
                            {roleLabel(member.role)}
                          </Badge>
                        )}
                        {rolePending ? (
                          <span role="status">Updating role…</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="gen2-share-link" aria-labelledby="share-link">
            <div className="gen2-share-section-heading">
              <h3 id="share-link">Anyone with the link</h3>
            </div>
            <p className="gen2-share-section-copy">
              Send this link to a group: everyone can join as the role below. It
              expires seven days after creation. Joining and copying do not
              expire it. Changing the role or removing a member replaces or
              revokes the link.
            </p>
            {canInvite ? (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="workspace-share-link-role">
                    Link access role
                  </FieldLabel>
                  <select
                    id="workspace-share-link-role"
                    value={linkRole}
                    onChange={(event) =>
                      void handleLinkRoleChange(
                        event.target.value as Gen2WorkspaceRole,
                      )
                    }
                    disabled={linkLoading}
                    className="gen2-workspace-select"
                    aria-label="Link access role"
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </Field>
              </FieldGroup>
            ) : (
              <p className="gen2-share-section-copy">
                Viewers cannot create or change the share link.
              </p>
            )}
            {linkError ? (
              <Alert variant="destructive">
                <AlertTitle>Share link unavailable</AlertTitle>
                <AlertDescription>{linkError}</AlertDescription>
                {canInvite ? (
                  <WorkspaceButton
                    tone="secondary"
                    type="button"
                    onClick={() => void refreshShareLink()}
                    disabled={linkLoading}
                  >
                    Retry
                  </WorkspaceButton>
                ) : null}
              </Alert>
            ) : null}
            {inviteUrl ? (
              <Input
                readOnly
                value={shownInviteUrl}
                aria-label="Share link"
                onFocus={(event) => event.currentTarget.select()}
              />
            ) : linkLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : null}
            <WorkspaceButton
              type="button"
              tone="secondary"
              onClick={() => void handleCopyLink()}
              disabled={!inviteUrl || linkLoading || !canInvite}
            >
              {copied ? (
                <Check data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Copy data-icon="inline-start" aria-hidden="true" />
              )}
              {copied ? "Link copied to clipboard" : "Copy link"}
            </WorkspaceButton>
          </section>

          <DialogFooter>
            <WorkspaceButton
              type="button"
              tone="secondary"
              onClick={() => onOpenChange(false)}
            >
              Done
            </WorkspaceButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next && !removing) {
            setRemoveTarget(null);
            setRemoveError("");
          }
        }}
      >
        <AlertDialogContent
          className="gen2-workspace-surface"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            membersListRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Remove access?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget
                ? `${removeTarget.name || removeTarget.login} will lose access to this workspace. This does not delete their account.`
                : "This person will lose access to this workspace."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn’t remove access</AlertTitle>
              <AlertDescription>{removeError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <WorkspaceButton type="button" disabled={removing}>
                Cancel
              </WorkspaceButton>
            </AlertDialogCancel>
            <WorkspaceButton
              type="button"
              tone="destructive"
              disabled={removing}
              onClick={() => void confirmRemove()}
            >
              {removing ? "Removing…" : "Remove access"}
            </WorkspaceButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={transferTarget !== null}
        onOpenChange={(next) => {
          if (!next && !transferring) {
            setTransferTarget(null);
            setTransferError("");
          }
        }}
      >
        <AlertDialogContent className="gen2-workspace-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer ownership?</AlertDialogTitle>
            <AlertDialogDescription>
              {transferTarget
                ? `${transferTarget.name || transferTarget.login} becomes the owner. You become an editor and can no longer change roles, remove people, or transfer ownership.`
                : "The new owner can change roles and remove people. You become an editor."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {transferError ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn’t transfer ownership</AlertTitle>
              <AlertDescription>{transferError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <WorkspaceButton type="button" disabled={transferring}>
                Cancel
              </WorkspaceButton>
            </AlertDialogCancel>
            <WorkspaceButton
              type="button"
              tone="destructive"
              disabled={transferring}
              onClick={() => void confirmTransfer()}
            >
              {transferring ? "Transferring…" : "Confirm transfer"}
            </WorkspaceButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
