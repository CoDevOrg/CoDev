import "server-only";

import { createHash } from "node:crypto";

/**
 * Whether a password appears in the Have I Been Pwned corpus, using its
 * k-anonymity range API: only the first five hex characters of the SHA-1
 * leave the server, and padded responses hide which prefix was asked about.
 * An outage fails open; the local policy still applies.
 */
export async function isBreachedPassword(password: string) {
  const digest = createHash("sha1")
    .update(password)
    .digest("hex")
    .toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  try {
    const response = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        headers: { "Add-Padding": "true", "User-Agent": "CoDev" },
        signal: AbortSignal.timeout(2_500),
        cache: "no-store",
      },
    );
    if (!response.ok) return false;
    return (await response.text()).split("\n").some((line) => {
      const [hash, count] = line.trim().split(":");
      return hash === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
