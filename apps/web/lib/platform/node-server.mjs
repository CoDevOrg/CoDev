import { createServer } from "node:http";
import { prepareNodeRequest } from "./node-origin.mjs";
import next from "next";
import { handleNodeUpgrade } from "./node-websocket-server.mjs";

const port = Number(process.env.PORT || 3000);
const secret = process.env.AZURE_WEB_ORIGIN_SECRET;
if (!secret || secret.length < 32)
  throw new Error("Azure origin authentication is missing.");
const application = next({ dev: false, hostname: "0.0.0.0", port });
await application.prepare();
const handle = application.getRequestHandler();

const server = createServer(async (request, response) => {
  if (request.url === "/__codev/live") {
    response.end("ok");
    return;
  }
  if (request.url === "/__codev/ready") {
    try {
      const ready = await fetch(`http://127.0.0.1:${port}/api/ready`, {
        headers: {
          "x-codev-origin-secret": secret,
          "x-codev-public-host": "www.trycodev.com",
        },
        signal: AbortSignal.timeout(5_000),
      });
      await ready.body?.cancel();
      response.writeHead(ready.status).end();
    } catch {
      response.writeHead(503).end();
    }
    return;
  }
  if (!prepareNodeRequest(request, secret)) {
    response.writeHead(403).end();
    return;
  }
  try {
    await handle(request, response);
  } catch {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});
server.on("upgrade", (request, socket, head) => {
  if (
    !prepareNodeRequest(request, secret) ||
    !/^\/api\/gen2\/workspaces\/[^/]+\/(collaboration|terminal\/stream)(\?|$)/.test(
      request.url || "",
    )
  ) {
    socket.end(
      "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
    return;
  }
  void handleNodeUpgrade(request, socket, head, port);
});
server.listen(port, "0.0.0.0", () =>
  console.log(`CoDev Azure origin listening on ${port}`),
);
process.on("SIGTERM", () => {
  server.close();
  setTimeout(() => process.exit(0), 25_000).unref();
});
