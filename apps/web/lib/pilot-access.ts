export function parsePilotAdminLogins(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPilotAdminLogin(
  login: string | null | undefined,
  allowlist = process.env.PILOT_ADMIN_GITHUB_LOGINS,
) {
  if (!login) return false;
  return parsePilotAdminLogins(allowlist).has(login.toLowerCase());
}
