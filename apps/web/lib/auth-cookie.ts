export function getSharedAuthCookieDomain(vercelEnvironment?: string) {
  return vercelEnvironment === "production" ? ".trycodev.com" : undefined;
}

export function getSharedAuthCookieName(vercelEnvironment?: string) {
  return vercelEnvironment === "production"
    ? "__Secure-codev.session-token"
    : undefined;
}
