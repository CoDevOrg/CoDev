import type { IncomingMessage, ServerResponse } from "node:http";

import {
  createHocuspocusServer,
  verifyWorkspaceToken,
} from "./rooms/hocuspocus";
import { PostgresDocumentStore } from "./rooms/postgres-store";

const port = Number(process.env.PORT ?? 8787);
const store = new PostgresDocumentStore();

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function handleHealth(
  _request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    await store.ping();
    json(response, 200, {
      status: "ok",
      service: "codev-hocuspocus",
      sync: "yjs",
    });
  } catch {
    json(response, 503, { status: "degraded" });
  }
}

const hocuspocus = createHocuspocusServer(
  store,
  async ({ token, documentName }) => {
    if (!documentName.startsWith("workspace:")) return null;
    return verifyWorkspaceToken(token);
  },
);

// Hocuspocus owns the listener and WebSocket upgrade path. Replace only the
// request callback so health checks do not fall through to its welcome page.
hocuspocus.httpServer.removeAllListeners("request");
hocuspocus.httpServer.on("request", (request, response) => {
  if (request.url === "/healthz" && request.method === "GET") {
    void handleHealth(request, response);
    return;
  }
  void hocuspocus.requestHandler(request, response);
});

void hocuspocus.listen(port);

const shutdown = async () => {
  await hocuspocus.destroy();
  await store.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
