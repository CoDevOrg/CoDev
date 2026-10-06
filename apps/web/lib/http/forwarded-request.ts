import "server-only";

const publicHosts = new Set([
  "trycodev.com",
  "www.trycodev.com",
  "admins.trycodev.com",
]);

/** Next's custom server builds internal URLs; retain the authenticated edge origin. */
export function forwardedRequest(request: Request) {
  const secret = process.env.AZURE_WEB_ORIGIN_SECRET;
  const host = request.headers.get("x-codev-public-host");
  if (
    !secret ||
    request.headers.get("x-codev-origin-secret") !== secret ||
    !host ||
    !publicHosts.has(host)
  )
    return request;
  const url = new URL(request.url);
  if (url.origin === `https://${host}`) return request;
  url.protocol = "https:";
  url.hostname = host;
  url.port = "";
  return new Request(url, request);
}
