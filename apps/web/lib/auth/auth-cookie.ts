/** Host-only cookies keep browser credentials off runtime and sibling hosts. */
export function getSessionCookie(
  production = process.env.NODE_ENV === "production",
) {
  return {
    name: production ? "__Host-codev.session-token" : "codev.session-token",
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure: production,
    },
  };
}
