import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { upgradeNodeWebSocket } from "./node-websocket";
import { handleNodeUpgrade } from "./node-websocket-server.mjs";

afterEach(() => {
  (
    globalThis as typeof globalThis & {
      __codevNodeWebSocketUpgrades?: Map<string, unknown>;
    }
  ).__codevNodeWebSocketUpgrades?.clear();
});

describe("authenticated Node socket upgrade", () => {
  it("does not accept a forged upgrade ID", () => {
    expect(
      upgradeNodeWebSocket(
        new Request("http://localhost/", {
          headers: { "x-codev-node-websocket-id": "forged" },
        }),
        () => {
          throw new Error("must not connect");
        },
        { maxPayload: 10 },
      ),
    ).toBeUndefined();
  });

  it("accepts through the authorized route and enforces payload limits", async () => {
    const server = createServer((request, response) => {
      if (request.headers.authorization !== "Bearer test") {
        response.writeHead(401).end();
        return;
      }
      const result = upgradeNodeWebSocket(
        new Request("http://localhost/", {
          headers: {
            "x-codev-node-websocket-id": String(
              request.headers["x-codev-node-websocket-id"],
            ),
          },
        }),
        (socket) => {
          socket.onMessage(({ data }) => {
            if (data) socket.send(data);
          });
        },
        { maxPayload: 16 },
      );
      response.writeHead(result?.status || 503).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    server.on(
      "upgrade",
      (req, socket, head) => void handleNodeUpgrade(req, socket, head, port),
    );
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`, {
      headers: { authorization: "Bearer test" },
    });
    try {
      await once(socket, "open");
      const received = once(socket, "message");
      socket.send("hello");
      expect(String((await received)[0])).toBe("hello");
      const closed = once(socket, "close");
      socket.send("a".repeat(17));
      expect((await closed)[0]).toBe(1009);
    } finally {
      socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns an authorization rejection without opening a socket", async () => {
    const server = createServer((_req, response) =>
      response.writeHead(401).end(),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    server.on(
      "upgrade",
      (req, socket, head) => void handleNodeUpgrade(req, socket, head, port),
    );
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
    socket.on("error", () => undefined);
    try {
      const [, response] = await once(socket, "unexpected-response");
      expect(response.statusCode).toBe(401);
      response.resume();
    } finally {
      socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
