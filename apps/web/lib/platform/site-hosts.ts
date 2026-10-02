export const ADMIN_HOSTNAME = "admins.trycodev.com";
export const PUBLIC_APP_ORIGIN = "https://www.trycodev.com";

export function isAdminHostname(hostname: string | null | undefined): boolean {
  return hostname?.split(":")[0]?.toLowerCase() === ADMIN_HOSTNAME;
}

export function publicAppHref(pathname: string, isAdminHost: boolean) {
  return isAdminHost ? `${PUBLIC_APP_ORIGIN}${pathname}` : pathname;
}

/** Paths the admin hostname is allowed to serve itself. */
export function adminHostKeepsPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/")
  );
}

/** Where a non-admin path on the admin hostname should go. */
export function publicAppUrl(pathname: string, search = "") {
  return `${PUBLIC_APP_ORIGIN}${pathname}${search}`;
}
