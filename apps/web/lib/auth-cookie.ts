export function getSharedAuthCookieDomain(vercelEnvironment?: string) {
  return vercelEnvironment === "production" ? ".trycodev.com" : undefined;
}
