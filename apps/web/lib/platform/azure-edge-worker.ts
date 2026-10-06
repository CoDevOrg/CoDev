type Environment = {
  AZURE_WEB_ORIGIN: string;
  AZURE_WEB_ORIGIN_SECRET: string;
  CRON_SECRET: string;
};

const hosts = new Set([
  "trycodev.com",
  "www.trycodev.com",
  "admins.trycodev.com",
]);

/** Keep public request CPU work at the edge to a small, streaming proxy. */
const worker = {
  async fetch(request: Request, env: Environment) {
    const incoming = new URL(request.url);
    if (!hosts.has(incoming.hostname))
      return new Response("Not Found", { status: 404 });
    const target = new URL(env.AZURE_WEB_ORIGIN);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("x-codev-origin-secret", env.AZURE_WEB_ORIGIN_SECRET);
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-codev-public-host", incoming.host);
    headers.set("x-forwarded-proto", "https");
    headers.set(
      "x-forwarded-for",
      request.headers.get("cf-connecting-ip") || "unknown",
    );
    headers.delete("x-codev-node-websocket-id");
    try {
      return await fetch(
        new Request(target, {
          method: request.method,
          headers,
          body: request.body,
          redirect: "manual",
        }),
      );
    } catch {
      return new Response(
        "CoDev is temporarily unavailable. Please retry shortly.",
        {
          status: 503,
          headers: { "retry-after": "5", "cache-control": "no-store" },
        },
      );
    }
  },
  async scheduled(_controller: ScheduledController, env: Environment) {
    for (const path of [
      "/api/gen2/compute/reconcile",
      "/api/gen2/agents/monitor",
    ]) {
      const response = await fetch(`${env.AZURE_WEB_ORIGIN}${path}`, {
        headers: {
          "x-codev-origin-secret": env.AZURE_WEB_ORIGIN_SECRET,
          "x-codev-public-host": "www.trycodev.com",
          Authorization: `Bearer ${env.CRON_SECRET}`,
        },
        signal: AbortSignal.timeout(120_000),
      });
      await response.body?.cancel();
      if (!response.ok)
        throw new Error(`Azure scheduled ${path} returned ${response.status}`);
    }
  },
};

export default worker;
