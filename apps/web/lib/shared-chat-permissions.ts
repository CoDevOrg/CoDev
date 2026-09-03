export type SharedChatRole = "owner" | "member";

export function permissionsForSharedChatRole(role: string) {
  const isMember = role === "owner" || role === "member";
  return {
    read: isMember,
    post: isMember,
    invite: role === "owner",
  };
}
