import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createWorkspacePreviewProxy } from "./arm-workspace-preview.mjs";
import { listListeningPorts } from "./arm-workspace-preview-upstream.mjs";

// Public identity written by codev-activate-arm-boot. The proxy never reads the
// root-only runtime files or the tunnel token.
const identityPath = "/etc/codev-preview/identity.json";

async function previewServer() {
  try {
    const config = JSON.parse(await readFile(identityPath, "utf8"));
    if (
      typeof config.workspaceId !== "string" ||
      !Number.isSafeInteger(config.generation) ||
      config.generation < 1 ||
      typeof config.verificationPublicKey !== "string"
    )
      throw new Error("Invalid preview identity");
    return createWorkspacePreviewProxy({
      identity: {
        workspaceId: config.workspaceId,
        generation: config.generation,
      },
      verifyKey: createPublicKey(config.verificationPublicKey),
      listListeningPorts,
    });
  } catch (error) {
    // Keep holding the port until activation; the verified boot restarts this
    // service once the identity exists. Never exit into a socket restart loop.
    console.error(
      `Preview identity unavailable: ${error.code ?? error.message}`,
    );
    return createServer((_request, response) => {
      response.writeHead(503, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Cloudflare-CDN-Cache-Control": "no-store",
      });
      response.end("Preview is not ready.");
    }).on("upgrade", (_request, socket) => socket.destroy());
  }
}

const server = await previewServer();
// systemd socket activation passes the 127.0.0.1:5261 listener as fd 3.
if (
  process.env.LISTEN_FDS === "1" &&
  process.env.LISTEN_PID === String(process.pid)
)
  server.listen({ fd: 3 });
else server.listen(5261, "127.0.0.1");
