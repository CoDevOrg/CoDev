export type ClerkProfileForLogin = {
  id: string;
  username?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  externalAccounts?: Array<{
    provider?: unknown;
    username?: unknown;
  }> | null;
};

export function deriveClerkLogin(profile: ClerkProfileForLogin) {
  const githubLogin = profile.externalAccounts?.find((account) => {
    const provider =
      typeof account.provider === "string"
        ? account.provider.toLowerCase()
        : "";
    return (
      provider.includes("github") &&
      typeof account.username === "string" &&
      account.username.trim().length > 0
    );
  });

  return (
    (typeof githubLogin?.username === "string"
      ? githubLogin.username.trim()
      : "") ||
    profile.username?.trim() ||
    profile.primaryEmailAddress?.emailAddress?.split("@")[0]?.trim() ||
    `user-${profile.id.slice(-12)}`
  );
}
