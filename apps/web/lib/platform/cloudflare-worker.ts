import application from "vinext/server/fetch-handler";
import { dispatchArmWorkflow } from "../gen2/arm-workflow-bridge";
import {
  cloudflareWebSocketUpgradeIdHeader,
  takeCloudflareWebSocket,
} from "./websocket";

export { ArmWorkspaceLifecycleWorkflow } from "../runtime/arm-workspace-workflow";

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
    // Azure calls the retained lifecycle service directly, bypassing SSR and
    // session middleware. Dispatch still validates its service credential.
    if (new URL(request.url).pathname === "/api/gen2/compute/workflow") {
      try {
        return Response.json(await dispatchArmWorkflow(request));
      } catch (error) {
        const status =
          error instanceof Error && "status" in error
            ? Number(error.status)
            : 503;
        return Response.json(
          { error: "Workflow service unavailable." },
          { status },
        );
      }
    }
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
      if (!socket) return response;
      ctx.waitUntil(socket.initialized);
      return upgradedResponse(response, socket.socket);
    } catch (error) {
      const socket = takeCloudflareWebSocket(id);
      if (socket) {
        ctx.waitUntil(socket.initialized);
        return upgradedResponse(new Response(null), socket.socket);
      }
      throw error;
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    for (const path of [
      "/api/gen2/compute/reconcile",
      "/api/gen2/agents/monitor",
    ]) {
      const response = await application.fetch(
        new Request(`https://internal${path}`, {
          headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
        }),
        env,
        ctx,
      );
      if (!response.ok) {
        throw new Error(`Scheduled ${path} failed with ${response.status}`);
      }
      await response.text();
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
