import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  clients: [] as Array<{ on: ReturnType<typeof vi.fn> }>,
}));
vi.mock("@codev/config", () => ({
  readServerEnvironment: () => ({ REDIS_URL: "redis://fixture" }),
}));
vi.mock("ioredis", () => ({
  default: class {
    on = vi.fn();
    constructor() {
      mocks.clients.push(this);
    }
  },
}));
import {
  collaborationContext,
  withGen2CollaborationContext,
} from "./collaboration-context";
import { getInstanceId, redisClient } from "./collaboration-redis";

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.clients.length = 0;
});

it("gives simultaneous Worker sockets separate Redis clients, room maps, and stream identities", async () => {
  vi.stubGlobal("WebSocketPair", class {});
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstId = "";
  let firstRooms: unknown;
  const first = withGen2CollaborationContext(async () => {
    const client = redisClient();
    firstId = getInstanceId();
    firstRooms = collaborationContext.getStore()!.rooms;
    await pending;
    expect(redisClient()).toBe(client);
    expect(getInstanceId()).toBe(firstId);
  });
  await withGen2CollaborationContext(async () => {
    expect(getInstanceId()).not.toBe(firstId);
    expect(collaborationContext.getStore()!.rooms).not.toBe(firstRooms);
    expect(redisClient()).toBe(redisClient());
    expect(mocks.clients).toHaveLength(2);
  });
  release();
  await first;
});
