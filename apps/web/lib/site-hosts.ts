export const ADMIN_HOSTNAME = "admins.trycodev.com";
export const PUBLIC_APP_ORIGIN = "https://www.trycodev.com";

export function isAdminHostname(hostname: string | null | undefined): boolean {
  return hostname?.split(":")[0]?.toLowerCase() === ADMIN_HOSTNAME;
}

export function publicAppHref(pathname: string, isAdminHost: boolean) {
  return isAdminHost ? `${PUBLIC_APP_ORIGIN}${pathname}` : pathname;
}
