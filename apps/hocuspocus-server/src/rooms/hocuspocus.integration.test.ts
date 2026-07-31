import { createHmac } from "node:crypto";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vitest";

import { createHocuspocusServer, verifyWorkspaceToken } from "./hocuspocus";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const tokenSecret = "hocuspocus-integration-secret-32-bytes";

function tokenFor(userId: string, userName: string, canEdit: boolean) {
  const payload = Buffer.from(
    JSON.stringify({
      workspaceId,
      userId,
      userName,
      canEdit,
      expiresAt: Date.now() + 60_000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", tokenSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

class MemoryStore {
  private readonly documents = new Map<string, Uint8Array>();

  async load(documentName: string) {
    const state = this.documents.get(documentName);
    return state ? Uint8Array.from(state) : null;
  }

  async store(documentName: string, state: Uint8Array) {
    this.documents.set(documentName, Uint8Array.from(state));
  }
}

function eventually(predicate: () => boolean, timeoutMs = 5_000) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for Hocuspocus synchronization."));
      }
    }, 20);
    timer.unref();
  });
}

describe("Hocuspocus Yjs room synchronization", () => {
  let server: ReturnType<typeof createHocuspocusServer> | null = null;
  const providers: HocuspocusProvider[] = [];

  afterEach(async () => {
    for (const provider of providers.splice(0)) provider.destroy();
    await server?.destroy();
    server = null;
  });

  it("syncs document content and awareness cursors between two clients", async () => {
    const store = new MemoryStore();
    server = createHocuspocusServer(store, async ({ token, documentName }) =>
      documentName.startsWith("workspace:")
        ? verifyWorkspaceToken(token, tokenSecret)
        : null,
    );
    server.configuration.port = 0;
    await server.listen();

    const documentName = `workspace:${workspaceId}:src/app.tsx`;
    const first = new Y.Doc();
    const second = new Y.Doc();
    const firstAwareness = new Awareness(first);
    const secondAwareness = new Awareness(second);
    firstAwareness.setLocalStateField("user", {
      id: "user-one",
      cursor: { path: "src/app.tsx", line: 7, column: 12 },
    });

    const firstProvider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${server.address.port}`,
      name: documentName,
      document: first,
      awareness: firstAwareness,
      token: tokenFor("user-one", "User One", true),
    });
    const secondProvider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${server.address.port}`,
      name: documentName,
      document: second,
      awareness: secondAwareness,
      token: tokenFor("user-two", "User Two", true),
    });
    providers.push(firstProvider, secondProvider);
    await Promise.all([firstProvider.connect(), secondProvider.connect()]);
    await eventually(() => firstProvider.isSynced && secondProvider.isSynced);

    first.getText("content").insert(0, "export const ready = true;\n");
    await eventually(
      () =>
        second.getText("content").toString() === "export const ready = true;\n",
    );
    await eventually(() =>
      [...secondAwareness.getStates().values()].some(
        (state) =>
          state.user?.id === "user-one" &&
          state.user.cursor?.path === "src/app.tsx" &&
          state.user.cursor?.line === 7,
      ),
    );

    expect(second.getText("content").toString()).toContain("ready = true");
  });

  it("rejects Yjs updates from read-only workspace members", async () => {
    const store = new MemoryStore();
    server = createHocuspocusServer(store, async ({ token, documentName }) =>
      documentName.startsWith("workspace:")
        ? verifyWorkspaceToken(token, tokenSecret)
        : null,
    );
    server.configuration.port = 0;
    await server.listen();

    const documentName = `workspace:${workspaceId}:src/read-only.tsx`;
    const writer = new Y.Doc();
    const reader = new Y.Doc();
    const writerProvider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${server.address.port}`,
      name: documentName,
      document: writer,
      token: tokenFor("writer", "Writer", true),
    });
    const readerProvider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${server.address.port}`,
      name: documentName,
      document: reader,
      token: tokenFor("readonly", "Read Only", false),
    });
    providers.push(writerProvider, readerProvider);
    await Promise.all([writerProvider.connect(), readerProvider.connect()]);
    await eventually(() => writerProvider.isSynced && readerProvider.isSynced);

    writer.getText("content").insert(0, "writer content\n");
    await eventually(
      () => reader.getText("content").toString() === "writer content\n",
    );

    reader.getText("content").insert(0, "blocked content\n");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(writer.getText("content").toString()).toBe("writer content\n");
  });
});
