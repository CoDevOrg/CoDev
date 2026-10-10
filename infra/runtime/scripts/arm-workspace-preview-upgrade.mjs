import { STATUS_CODES } from "node:http";
import { connect } from "node:net";
import { PREVIEW_COOKIE } from "./arm-workspace-preview-token.mjs";
import { upstreamRequestHeaders } from "./arm-workspace-preview-upstream.mjs";

const MAX_SWITCH_HEAD = 16 * 1024;
const SWITCHED = /^HTTP\/1\.1 101(?: |$)/;
const PLANTED_COOKIE = new RegExp(`^set-cookie:\\s*${PREVIEW_COOKIE}=`, "i");

function refuse(socket, status, message) {
  if (socket.writableEnded || socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n` +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "Cache-Control: no-store\r\nCloudflare-CDN-Cache-Control: no-store\r\n" +
      `Connection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
}

// A WebSocket handshake carries no body, so nothing after its headers can
// reach the dev server before it agrees to switch protocols.
function isWebSocketHandshake({ method, headers }) {
  return (
    method === "GET" &&
    /^websocket$/i.test(headers.upgrade ?? "") &&
    headers["transfer-encoding"] === undefined &&
    (headers["content-length"] ?? "0") === "0"
  );
}

function handshake(request, target) {
  const headers = upstreamRequestHeaders(request.rawHeaders, {
    ...target,
    upgrade: true,
  });
  let lines = `GET ${request.url} HTTP/1.1\r\n`;
  for (let at = 0; at < headers.length; at += 2)
    lines += `${headers[at]}: ${headers[at + 1]}\r\n`;
  return `${lines}\r\n`;
}

// Hold the dev server's answer until its head is complete. Only a 101 reaches
// the browser; any other answer would skip the cache and framing rules that
// every proxied response gets, so it never leaves the guest.
function readSwitch(upstream, done) {
  let received = Buffer.alloc(0);
  const onData = (chunk) => {
    received = Buffer.concat([received, chunk]);
    const end = received.indexOf("\r\n\r\n");
    if (end < 0 && received.length <= MAX_SWITCH_HEAD) return;
    upstream.off("data", onData);
    upstream.pause();
    const lines =
      end < 0 ? [] : received.toString("latin1", 0, end).split("\r\n");
    if (!SWITCHED.test(lines[0] ?? "")) return done(null);
    const head = lines.filter((line) => !PLANTED_COOKIE.test(line));
    done(
      Buffer.concat([
        Buffer.from(`${head.join("\r\n")}\r\n\r\n`, "latin1"),
        received.subarray(end + 4),
      ]),
    );
  };
  upstream.on("data", onData);
}

// After the same admission as HTTP and a 101 from the dev server, WebSocket
// bytes are piped untouched in both directions.
export async function proxyPreviewUpgrade(request, socket, head, admit) {
  socket.on("error", () => socket.destroy());
  if (!isWebSocketHandshake(request))
    return refuse(socket, 400, "Only WebSocket upgrades are supported.");
  const target = await admit();
  if (target.status) return refuse(socket, target.status, target.message);
  if (socket.destroyed) return;
  const upstream = connect({ host: target.address, port: target.port });
  let piped = false;
  const fail = (message) => {
    upstream.destroy();
    if (piped) return socket.destroy();
    refuse(socket, 502, message);
  };
  const gone = `Nothing is answering on port ${target.port}.`;
  upstream.once("connect", () => upstream.write(handshake(request, target)));
  readSwitch(upstream, (answer) => {
    if (!answer)
      return fail(`Port ${target.port} did not accept the WebSocket.`);
    piped = true;
    socket.write(answer);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => fail(gone));
  upstream.on("close", () => fail(gone));
  socket.on("close", () => upstream.destroy());
}
