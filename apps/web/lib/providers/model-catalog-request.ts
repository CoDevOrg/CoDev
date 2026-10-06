import "server-only";

/** Provider errors must never echo a response body or authentication material. */
export async function modelCatalogRequest(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Account model discovery is unavailable.");
  const text = await response.text();
  if (text.length > 4_000_000)
    throw new Error("Account model catalog is too large.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Account model catalog is invalid.");
  }
}
