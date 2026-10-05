/** Bound both network delivery and body consumption; abort releases the request. */
export async function boundedJsonRequest<T>(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): Promise<{ response: Response; payload: T }> {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, { ...options, signal });
        if (
          options.redirect === "manual" &&
          response.status >= 300 &&
          response.status < 400
        )
          throw new Error("Workspace request was redirected.");
        const payload = (await response.json()) as T;
        return { response, payload };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Workspace request timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
