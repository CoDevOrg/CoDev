import { apiError, getApiUser } from "@/lib/api";
import { requireWorkspacePermission } from "@/lib/access";
import { proxySandboxTheia } from "@/lib/orchestrator";
import { ensureWorkspaceRuntimeReady } from "@/lib/runtime-resume";
import { scopeTheiaConnectionCookie, theiaSocketProxyPath } from "@/lib/theia";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ workspaceId: string; path?: string[] }>;
};

async function proxy(request: Request, context: RouteContext) {
  const user = await getApiUser();
  if (!user?.id) {
    return apiError(new Error("Authentication required."), 401);
  }

  const { workspaceId, path = [] } = await context.params;
  const endpoint = path.length === 1 ? path[0] : undefined;
  if (endpoint !== "socket.io" && endpoint !== "bootstrap") {
    return apiError(new Error("Theia endpoint not found."), 404);
  }

  try {
    await requireWorkspacePermission(workspaceId, user.id, "edit");
    await ensureWorkspaceRuntimeReady(workspaceId, user.id, "coSteer");

    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.arrayBuffer() : null;
    if (body && body.byteLength > 2 * 1_024 * 1_024) {
      return apiError(new Error("Theia request is too large."), 413);
    }
    const forwardedHeaders: Record<string, string> = {};
    for (const name of ["accept", "content-type", "origin", "user-agent"]) {
      const value = request.headers.get(name);
      if (value) forwardedHeaders[name] = value;
    }
    const theiaCookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("theia-connection-token="));
    if (theiaCookie) forwardedHeaders.cookie = theiaCookie;
    const response = await proxySandboxTheia(workspaceId, {
      method: request.method as "GET" | "POST",
      path: endpoint === "bootstrap" ? "/" : theiaSocketProxyPath(url.search),
      headers: forwardedHeaders,
      bodyBase64: body ? Buffer.from(body).toString("base64") : "",
    });
    const headers = new Headers({
      "cache-control": "no-store",
      "content-type": response.headers["content-type"] ?? "text/plain",
    });
    if (response.headers["set-cookie"]) {
      headers.set(
        "set-cookie",
        scopeTheiaConnectionCookie(response.headers["set-cookie"], workspaceId),
      );
    }
    const responseBody = Buffer.from(response.bodyBase64, "base64");
    const requestPacket = body ? enginePacketType(Buffer.from(body)) : null;
    const responsePacket = enginePacketType(responseBody);
    if (
      requestPacket !== null ||
      responsePacket === "ping" ||
      response.status >= 400
    ) {
      console.info(
        JSON.stringify({
          event: "theia.transport",
          workspaceId,
          requestPacket,
          requestBytes: body?.byteLength ?? 0,
          responsePacket,
          responseBytes: responseBody.byteLength,
          status: response.status,
        }),
      );
    }
    return new Response(new Uint8Array(responseBody), {
      status: response.status,
      headers,
    });
  } catch (error) {
    return apiError(
      error,
      error instanceof Error && "status" in error ? Number(error.status) : 503,
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

function enginePacketType(body: Uint8Array) {
  if (body.byteLength === 0 || body.byteLength > 8) return null;
  const firstByte = body[0];
  if (firstByte === "2".charCodeAt(0)) return "ping";
  if (firstByte === "3".charCodeAt(0)) return "pong";
  if (firstByte !== undefined) return `control:${firstByte}`;
  return null;
}
