"use client";

import type { Ref } from "react";
import { Crown, MoreHorizontal, UserMinus } from "lucide-react";
import type { Gen2WorkspaceMember, Gen2WorkspaceRole } from "@codev/contracts";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceButton } from "./workspace-button";

const ROLE_LABEL: Record<Gen2WorkspaceRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

function initials(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : label.slice(0, 2);
  return letters.toUpperCase();
}

function MemberActions({
  member,
  pending,
  onRoleChange,
  onTransfer,
  onRemove,
}: {
  member: Gen2WorkspaceMember;
  pending: boolean;
  onRoleChange: (role: Gen2WorkspaceRole) => void;
  onTransfer: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <select
        value={member.role === "owner" ? "editor" : member.role}
        onChange={(event) =>
          onRoleChange(event.target.value as Gen2WorkspaceRole)
        }
        className="gen2-workspace-select"
        aria-label={`Change role for ${member.login}`}
        disabled={pending}
      >
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      {/* Not modal: its items open an AlertDialog, and a modal menu would
          leave the page inert behind it. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <WorkspaceButton
            size="icon"
            aria-label={`More actions for ${member.login}`}
            disabled={pending}
          >
            <MoreHorizontal aria-hidden="true" />
          </WorkspaceButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="gen2-workspace-surface gen2-share-menu"
        >
          <DropdownMenuItem onSelect={onTransfer}>
            <Crown aria-hidden="true" /> Transfer ownership…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-variant="destructive" onSelect={onRemove}>
            <UserMinus aria-hidden="true" /> Remove access…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Everyone with access. Only the owner sees controls, and never on their own
 * row: roles change inline, while transfer and removal sit behind a menu and
 * each asks for confirmation.
 */
export function WorkspaceShareMembers({
  members,
  ready,
  error,
  ownerId,
  currentUserId,
  isOwner,
  updatingUserId,
  listRef,
  onRetry,
  onRoleChange,
  onTransfer,
  onRemove,
}: {
  members: Gen2WorkspaceMember[];
  ready: boolean;
  error: string;
  ownerId: string;
  currentUserId?: string | undefined;
  isOwner: boolean;
  updatingUserId: string | null;
  listRef: Ref<HTMLUListElement>;
  onRetry: () => void;
  onRoleChange: (member: Gen2WorkspaceMember, role: Gen2WorkspaceRole) => void;
  onTransfer: (member: Gen2WorkspaceMember) => void;
  onRemove: (member: Gen2WorkspaceMember) => void;
}) {
  if (error) {
    return (
      <div className="gen2-share-notice" data-type="error" role="alert">
        <span>{error}</span>
        <WorkspaceButton tone="secondary" type="button" onClick={onRetry}>
          Retry
        </WorkspaceButton>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="gen2-share-skeletons" aria-hidden="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  return (
    <ul ref={listRef} tabIndex={-1} className="gen2-share-members">
      {members.map((member) => {
        const label = member.name || member.login;
        const isYou = member.userId === currentUserId;
        const isMemberOwner =
          member.role === "owner" || member.userId === ownerId;
        const pending = updatingUserId === member.userId;
        return (
          <li key={member.userId} className="gen2-share-member">
            <Avatar className="gen2-share-avatar">
              <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
              <AvatarFallback>{initials(label)}</AvatarFallback>
            </Avatar>
            <span className="gen2-share-member-name">
              <span>
                {label}
                {isYou ? <span className="gen2-share-you"> (you)</span> : null}
              </span>
              <span>{member.email || `@${member.login}`}</span>
            </span>
            <span className="gen2-share-member-actions">
              {isOwner && !isYou && !isMemberOwner ? (
                <MemberActions
                  member={member}
                  pending={pending}
                  onRoleChange={(role) => onRoleChange(member, role)}
                  onTransfer={() => onTransfer(member)}
                  onRemove={() => onRemove(member)}
                />
              ) : (
                <span className="gen2-share-role">
                  {ROLE_LABEL[member.role]}
                </span>
              )}
              {pending ? (
                <span className="sr-only" role="status">
                  Updating role…
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
