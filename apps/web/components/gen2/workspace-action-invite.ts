import type { Gen2WorkspaceMember, Gen2WorkspaceRole } from "@codev/contracts";

import type { WorkspaceActionResult } from "./workspace-controller";
import {
  addWorkspaceMember,
  listWorkspaceMembers,
} from "./workspace-share-client";

type Detail = NonNullable<WorkspaceActionResult["details"]>[number];

/** Shown per person when CoDev has no account for them. */
export const NO_CODEV_ACCOUNT = "No CoDev account";

function normalize(person: string) {
  return person.trim().replace(/^@/, "").toLowerCase();
}

function memberFor(members: Gen2WorkspaceMember[], person: string) {
  return members.find(
    (member) =>
      member.login.toLowerCase() === person ||
      member.email?.toLowerCase() === person,
  );
}

async function inviteOne(
  workspaceId: string,
  person: string,
  role: Gen2WorkspaceRole,
  members: Gen2WorkspaceMember[],
): Promise<{ detail: Detail; members: Gen2WorkspaceMember[] }> {
  const existing = memberFor(members, normalize(person));
  if (existing) {
    // Never a role change: an agent's proposal must not demote anyone.
    const message = `Already has access as ${existing.role}`;
    return { detail: { person, ok: true, message }, members };
  }
  try {
    // Agents write GitHub handles as @login; CoDev looks logins up bare.
    const emailOrLogin = person.replace(/^@/, "");
    const result = await addWorkspaceMember(workspaceId, emailOrLogin, role);
    if (result.ok && result.members) {
      const detail = { person, ok: true, message: `Added as ${role}` };
      return { detail, members: result.members };
    }
    const message =
      result.status === 404
        ? NO_CODEV_ACCOUNT
        : (result.error ?? "Couldn’t add this person");
    return { detail: { person, ok: false, message }, members };
  } catch {
    const message = "Couldn’t reach CoDev";
    return { detail: { person, ok: false, message }, members };
  }
}

function summary(details: Detail[]) {
  const count = (test: (detail: Detail) => boolean) =>
    details.filter(test).length;
  const added = count((detail) => detail.message.startsWith("Added"));
  const already = count((detail) => detail.message.startsWith("Already"));
  const missing = count((detail) => detail.message === NO_CODEV_ACCOUNT);
  const failed = count((detail) => !detail.ok) - missing;
  return [
    added ? `Invited ${added}` : "",
    already ? `${already} already had access` : "",
    missing ? `${missing} need${missing === 1 ? "s" : ""} an invite link` : "",
    failed ? `${failed} failed` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Adds each new person one at a time after re-reading who already has
 * access. Existing members are skipped, so this never changes a role, and it
 * never touches the share link: people without an account are pointed at
 * the Share dialog instead.
 */
export async function inviteWorkspaceMembers(
  workspaceId: string,
  people: string[],
  role: "editor" | "viewer",
): Promise<WorkspaceActionResult> {
  let members: Gen2WorkspaceMember[];
  try {
    const listed = await listWorkspaceMembers(workspaceId);
    if (!listed.ok || !listed.members) {
      const reason = listed.error ?? "Couldn’t load people with access.";
      return { ok: false, message: `${reason} Nothing was sent.` };
    }
    members = listed.members;
  } catch {
    return { ok: false, message: "Couldn’t reach CoDev. Nothing was sent." };
  }
  const unique = [
    ...new Map(people.map((person) => [normalize(person), person])).values(),
  ];
  const details: Detail[] = [];
  for (const person of unique) {
    const next = await inviteOne(workspaceId, person.trim(), role, members);
    details.push(next.detail);
    members = next.members;
  }
  return {
    ok: details.some((detail) => detail.ok),
    message: summary(details),
    details,
  };
}
