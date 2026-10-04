export const ANALYTICS_COOKIE = "codev_analytics";

export function analyticsAllowed(cookie: string, privacySignal = false) {
  return (
    !privacySignal &&
    cookie
      .split(";")
      .some((part) => part.trim() === `${ANALYTICS_COOKIE}=allowed`)
  );
}

/** Analytics never needs query strings, fragments, or resource identifiers. */
export function analyticsPath(value: string) {
  try {
    const path = new URL(value, "https://trycodev.com").pathname;
    return path.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":id",
    );
  } catch {
    return "/";
  }
}

export function analyticsReferrer(value: string | null) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}
