import application from "vinext/server/fetch-handler";
import {
  cloudflareWebSocketUpgradeIdHeader,
  takeCloudflareWebSocket,
} from "./websocket";

function isGen2WebSocketRequest(request: Request) {
  return (
    request.method === "GET" &&
    request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
    /^\/api\/gen2\/workspaces\/[^/]+\/(?:collaboration|terminal\/stream)\/?$/.test(
      new URL(request.url).pathname,
    )
  );
}

function upgradedResponse(response: Response, webSocket: WebSocket) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 101, headers, webSocket });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!isGen2WebSocketRequest(request)) {
      return application.fetch(request, env, ctx);
    }
    const id = crypto.randomUUID();
    const headers = new Headers(request.headers);
    headers.set(cloudflareWebSocketUpgradeIdHeader, id);
    const routedRequest = new Request(request, { headers });
    try {
      const response = await application.fetch(routedRequest, env, ctx);
      const socket = takeCloudflareWebSocket(id);
      return socket ? upgradedResponse(response, socket) : response;
    } catch (error) {
      const socket = takeCloudflareWebSocket(id);
      if (socket) return upgradedResponse(new Response(null), socket);
      throw error;
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    const response = await application.fetch(
      new Request("https://internal/api/gen2/compute/reconcile", {
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      }),
      env,
      ctx,
    );
    if (!response.ok) {
      throw new Error(`Compute reconciliation failed with ${response.status}`);
    }
    await response.text();
  },
} satisfies ExportedHandler<Env>;

export default worker;
