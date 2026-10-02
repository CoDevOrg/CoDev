import "server-only";

const IDENTITY_ENDPOINTS = [
  {
    url: "https://api.cursor.com/v1/me",
    authorization: (key: string) => `Bearer ${key}`,
  },
  {
    url: "https://api.cursor.com/v0/me",
    authorization: (key: string) =>
      `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
  },
] as const;

/**
 * Confirm a pasted key with Cursor before it is stored. A key Cursor
 * rejects is never encrypted. The response body is discarded so a rejected
 * key cannot be echoed back in an error.
 */
export async function verifyCursorApiKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
) {
  const key = apiKey.trim();
  if (key.length < 20 || key.length > 512) {
    throw new Error("Enter a valid Cursor API key.");
  }
  for (const endpoint of IDENTITY_ENDPOINTS) {
    const response = await cursorIdentity(
      endpoint.url,
      endpoint.authorization(key),
      fetchImpl,
    );
    if (response === "ok") return key;
    if (response === "rejected") {
      throw new Error("Cursor rejected that API key.");
    }
  }
  throw new Error("Cursor could not confirm that API key. Try it again.");
}

async function cursorIdentity(
  url: string,
  authorization: string,
  fetchImpl: typeof fetch,
): Promise<"ok" | "rejected" | "unavailable"> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: authorization,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return "ok";
    if (response.status === 401 || response.status === 403) return "rejected";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
