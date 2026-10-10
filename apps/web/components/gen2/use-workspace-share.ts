"use client";

import { useCallback, useEffect, useState } from "react";
import type { Gen2WorkspaceMember, Gen2WorkspaceRole } from "@codev/contracts";

import {
  addWorkspaceMember,
  listWorkspaceMembers,
} from "./workspace-share-client";

export type ShareNotice = { text: string; type: "success" | "error" };

type MembersResponse = { members?: Gen2WorkspaceMember[]; error?: string };

const SUCCESS_NOTICE_MS = 5_000;

async function sendJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as MembersResponse & {
    ownerId?: string;
    inviteUrl?: string;
    role?: Gen2WorkspaceRole;
  };
  return { ok: res.ok, data };
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Members, the reusable share link, and the requests that change them. Every
 * mutation reports its own result; nothing claims success before the server
 * answers. Removing someone or transferring ownership revokes the share link
 * on the server, so both fetch a fresh one afterwards.
 */
export function useWorkspaceShare({
  workspaceId,
  open,
  canShareLink,
  initialMembers,
}: {
  workspaceId: string;
  open: boolean;
  canShareLink: boolean;
  initialMembers?: Gen2WorkspaceMember[] | undefined;
}) {
  const base = `/api/gen2/workspaces/${encodeURIComponent(workspaceId)}`;
  const memberUrl = (userId: string) =>
    `${base}/members/${encodeURIComponent(userId)}`;
  const [members, setMembers] = useState(initialMembers ?? []);
  const [membersReady, setMembersReady] = useState(Boolean(initialMembers));
  const [membersError, setMembersError] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkRole, setLinkRole] = useState<Gen2WorkspaceRole>("editor");
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [notice, setNotice] = useState<ShareNotice | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const refreshMembers = useCallback(async () => {
    setMembersError("");
    try {
      const result = await listWorkspaceMembers(workspaceId);
      if (!result.ok || !result.members) {
        setMembersError(result.error ?? "Couldn’t load people with access.");
        return;
      }
      setMembers(result.members);
      if (result.ownerId) setOwnerId(result.ownerId);
      setMembersReady(true);
    } catch {
      setMembersError("Couldn’t reach CoDev to load people with access.");
    }
  }, [workspaceId]);

  const refreshLink = useCallback(
    async (role?: Gen2WorkspaceRole) => {
      setLinkLoading(true);
      setLinkError("");
      try {
        const { ok, data } = await sendJson(
          `${base}/share`,
          json("POST", role ? { role } : {}),
        );
        if (!ok || !data.inviteUrl) {
          setLinkError(data.error ?? "Couldn’t create a share link.");
          return false;
        }
        setLinkUrl(data.inviteUrl);
        if (data.role) setLinkRole(data.role);
        return true;
      } catch {
        setLinkError("Couldn’t reach CoDev to create a share link.");
        return false;
      } finally {
        setLinkLoading(false);
      }
    },
    [base],
  );

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      void refreshMembers();
      if (canShareLink) void refreshLink();
    }, 0);
    return () => clearTimeout(timeout);
  }, [open, canShareLink, refreshMembers, refreshLink]);

  useEffect(() => {
    if (notice?.type !== "success") return;
    const timeout = setTimeout(() => setNotice(null), SUCCESS_NOTICE_MS);
    return () => clearTimeout(timeout);
  }, [notice]);

  /** Applies a member mutation; returns an error message, or null on success. */
  async function mutate(url: string, init: RequestInit, fallback: string) {
    try {
      const { ok, data } = await sendJson(url, init);
      if (!ok || !data.members) return data.error ?? fallback;
      setMembers(data.members);
      setMembersReady(true);
      return null;
    } catch {
      return "Couldn’t reach CoDev. Check your connection and try again.";
    }
  }

  async function addMember(emailOrLogin: string, role: Gen2WorkspaceRole) {
    setNotice(null);
    let error: string | null = null;
    try {
      const result = await addWorkspaceMember(workspaceId, emailOrLogin, role);
      if (result.ok && result.members) {
        setMembers(result.members);
        setMembersReady(true);
      } else error = result.error ?? "Couldn’t add this person.";
    } catch {
      error = "Couldn’t reach CoDev. Check your connection and try again.";
    }
    setNotice(
      error
        ? { text: error, type: "error" }
        : { text: `Added ${emailOrLogin} as ${role}.`, type: "success" },
    );
    return !error;
  }

  async function updateRole(userId: string, role: Gen2WorkspaceRole) {
    setUpdatingUserId(userId);
    setNotice(null);
    const error = await mutate(
      memberUrl(userId),
      json("PATCH", { role }),
      "Couldn’t update that role.",
    );
    setUpdatingUserId(null);
    setNotice(
      error
        ? { text: error, type: "error" }
        : { text: `Updated role to ${role}.`, type: "success" },
    );
  }

  async function removeMember(member: Gen2WorkspaceMember) {
    const error = await mutate(
      memberUrl(member.userId),
      { method: "DELETE" },
      "Couldn’t remove this person.",
    );
    if (error) return error;
    setNotice({ text: "Removed member access.", type: "success" });
    if (canShareLink) void refreshLink(linkRole);
    return null;
  }

  async function transferOwnership(member: Gen2WorkspaceMember) {
    const error = await mutate(
      memberUrl(member.userId),
      json("PATCH", { role: "owner" }),
      "Couldn’t transfer ownership.",
    );
    if (error) return error;
    setOwnerId(member.userId);
    setNotice({
      text: `Ownership transferred to ${member.name || member.login}. You are now an editor.`,
      type: "success",
    });
    void refreshLink(linkRole);
    return null;
  }

  async function changeLinkRole(role: Gen2WorkspaceRole) {
    const previous = linkRole;
    setLinkRole(role);
    setNotice(null);
    if (!(await refreshLink(role))) {
      setLinkRole(previous);
      return;
    }
    setNotice({
      text: `Share link now invites people as ${role}.`,
      type: "success",
    });
  }

  return {
    members,
    membersReady,
    membersError,
    ownerId,
    refreshMembers,
    link: {
      url: linkUrl,
      role: linkRole,
      loading: linkLoading,
      error: linkError,
    },
    refreshLink,
    changeLinkRole,
    notice,
    setNotice,
    updatingUserId,
    addMember,
    updateRole,
    removeMember,
    transferOwnership,
  };
}
