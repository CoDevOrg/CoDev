/** Retire old domain-wide cookies, including Auth.js's chunked tokens. */
export function clearLegacySessionCookies(
  request: Request,
  response: Response,
) {
  const hostname = new URL(request.url).hostname;
  if (
    !["trycodev.com", "www.trycodev.com", "admins.trycodev.com"].includes(
      hostname,
    )
  )
    return;
  const names = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim().split("=")[0])
    .filter(
      (name) =>
        name &&
        /^__Secure-(?:codev|authjs)\.session-token(?:\.\d+)?$/.test(name),
    );
  names.forEach((name) =>
    response.headers.append(
      "set-cookie",
      `${name}=; Domain=trycodev.com; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    ),
  );
}
