/**
 * Browser previews serve members' dev servers from per-port hosts in a
 * dedicated Cloudflare zone. That content is untrusted, so the zone must be
 * its own registrable domain: a subdomain of the app's would be same-site
 * with it, receive SameSite cookies, and could toss app cookies.
 *
 * `CODEV_PREVIEW_ZONE` and `CODEV_PREVIEW_ZONE_ID` are non-secret repository
 * variables; previews stay off unless both are valid. Pure, so the request
 * proxy can pass the zone into the CSP (docs/WEB_HOSTING.md).
 */

export type Gen2PreviewConfig = { zone: string; zoneId: string };

type Environment = Record<string, string | undefined>;

const APP_DOMAIN = "trycodev.com";
const HOSTNAME =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export function readGen2PreviewConfig(
  environment: Environment = process.env,
): Gen2PreviewConfig | null {
  const zone = environment.CODEV_PREVIEW_ZONE?.trim().toLowerCase() ?? "";
  const zoneId = environment.CODEV_PREVIEW_ZONE_ID?.trim() ?? "";
  if (!HOSTNAME.test(zone) || !/^[0-9a-f]{32}$/.test(zoneId)) return null;
  if (zone === APP_DOMAIN || zone.endsWith(`.${APP_DOMAIN}`)) return null;
  return { zone, zoneId };
}

/**
 * Local development frames `http://localhost:<port>` directly, so the
 * Browser tab works against servers on the developer's own machine.
 */
export function isGen2PreviewDevDirect(environment: Environment = process.env) {
  return (
    environment.NODE_ENV === "development" &&
    environment.CODEV_PREVIEW_DEV_DIRECT === "1"
  );
}

/** Whether the workspace shows its Browser tab. */
export function isGen2PreviewEnabled(environment: Environment = process.env) {
  return (
    readGen2PreviewConfig(environment) !== null ||
    isGen2PreviewDevDirect(environment)
  );
}
