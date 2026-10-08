import "server-only";

/** Carries only the HTTP status, so callers can react to a rejected token. */
export class ModelCatalogRequestError extends Error {
  constructor(readonly status: number) {
    super("Account model discovery is unavailable.");
    this.name = "ModelCatalogRequestError";
  }
}

/** Provider errors must never echo a response body or authentication material. */
export async function modelCatalogRequest(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    // Workers supports manual/follow; reject every redirect without forwarding credentials.
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    console.warn("Account model request failed", {
      host: new URL(url).hostname,
      status: response.status,
    });
    throw new ModelCatalogRequestError(response.status);
  }
  const text = await response.text();
  if (text.length > 4_000_000)
    throw new Error("Account model catalog is too large.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Account model catalog is invalid.");
  }
}
