import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";

import { destroySandbox, provisionSandbox } from "./orchestrator";
import {
  handleSandboxTerminalSocket,
  type SandboxTerminalActor,
} from "./sandbox-terminal-server";

const live = Boolean(process.env.CODEV_LIVE_SANDBOX_E2E);
const workspaceIds: string[] = [];

class FakeSocket {
  readonly OPEN = 1;
  readonly sent: string[] = [];
  readyState = this.OPEN;
  private readonly listeners = new Map<string, ((value?: unknown) => void)[]>();

  on(event: string, listener: (value?: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  once(event: string, listener: (value?: unknown) => void) {
    const wrapped = (value?: unknown) => {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter(
          (candidate) => candidate !== wrapped,
        ),
      );
      listener(value);
    };
    return this.on(event, wrapped);
  }

  send(value: string) {
    this.sent.push(value);
  }

  emit(event: string, value?: unknown) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(value);
    }
  }
}

function eventually(predicate: () => boolean, timeoutMs = 30_000) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for live terminal output."));
      }
    }, 25);
    timer.unref();
  });
}

const actor: SandboxTerminalActor = {
  userId: "e010bd2c-a3c1-438f-acef-166287a3b1cb",
  userName: "Live E2E",
  avatarUrl: null,
};

describe.skipIf(!live)("live Firecracker terminal bridge", () => {
  afterEach(async () => {
    for (const workspaceId of workspaceIds.splice(0)) {
      await destroySandbox(workspaceId).catch(() => undefined);
    }
  });

  it("streams a cloud PTY through the browser WebSocket bridge", async () => {
    const workspaceId = crypto.randomUUID();
    workspaceIds.push(workspaceId);
    const snapshotContents = "CoDev live terminal bridge\n";
    const sandbox = await provisionSandbox({
      workspaceId,
      repositoryUrl: null,
      repositorySnapshot: {
        files: [
          {
            path: "README.md",
            mode: "100644",
            contentBase64: Buffer.from(snapshotContents).toString("base64"),
          },
        ],
        totalBytes: Buffer.byteLength(snapshotContents),
      },
      baseSha: "0".repeat(40),
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      resumeFromSnapshot: false,
      lifecycle: {
        timeoutMs: 14_400_000,
        lifecycle: { onTimeout: "pause", autoResume: true },
      },
    });
    expect(sandbox.status).toBe("ready");

    const socket = new FakeSocket();
    await handleSandboxTerminalSocket(
      workspaceId,
      socket as unknown as WebSocket,
      actor,
    );
    socket.emit(
      "message",
      JSON.stringify({ type: "start", rows: 24, columns: 100 }),
    );

    await eventually(() =>
      socket.sent.some((value) => JSON.parse(value).type === "ready"),
    );
    const ready = socket.sent
      .map((value) => JSON.parse(value) as { type: string; sessionId?: string })
      .find((value) => value.type === "ready");
    expect(ready?.sessionId).toMatch(/^term-/);

    socket.emit(
      "message",
      JSON.stringify({ type: "resize", rows: 30, columns: 120 }),
    );
    socket.emit(
      "message",
      JSON.stringify({ type: "input", data: "printf 'live-bridge-ok\\n'\n" }),
    );

    await eventually(() =>
      socket.sent.some(
        (value) =>
          JSON.parse(value).type === "data" &&
          JSON.parse(value).data.includes("live-bridge-ok"),
      ),
    );
    expect(
      socket.sent
        .map((value) => JSON.parse(value) as { type: string; event?: unknown })
        .find((value) => value.type === "ready")?.event,
    ).toMatchObject({ type: "TERMINAL_EXEC_START" });

    socket.emit("close");
  });
});
