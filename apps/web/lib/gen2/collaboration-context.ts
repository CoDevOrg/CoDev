import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type Redis from "ioredis";
import type { LocalRoom } from "./collaboration-rooms";

export const collaborationContext = new AsyncLocalStorage<{
  instanceId?: string;
  redis?: Redis;
  rooms: Map<string, LocalRoom>;
}>();

/** Worker TCP connections belong to one socket request, never the isolate. */
export function withGen2CollaborationContext<T>(action: () => Promise<T>) {
  if (typeof WebSocketPair !== "function") return action();
  return collaborationContext.run({ rooms: new Map() }, action);
}
