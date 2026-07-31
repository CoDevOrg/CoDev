import Redis from "ioredis";
import * as Y from "yjs";

const UPDATE_KEY_PREFIX = "codev:hocuspocus:doc:";
const PRESENCE_KEY_PREFIX = "codev:hocuspocus:presence:";

function key(documentName: string) {
  return `${UPDATE_KEY_PREFIX}${documentName}`;
}

function presenceKey(documentName: string) {
  return `${PRESENCE_KEY_PREFIX}${documentName}`;
}

export class RedisRoomStore {
  private readonly redis: Redis;

  constructor(url = process.env.REDIS_URL) {
    if (!url) throw new Error("REDIS_URL is required for Hocuspocus.");
    this.redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
  }

  async connect() {
    if (this.redis.status === "wait") await this.redis.connect();
  }

  async load(documentName: string) {
    await this.connect();
    const encoded = await this.redis.getBuffer(key(documentName));
    if (!encoded) return null;
    const document = new Y.Doc();
    Y.applyUpdate(document, encoded);
    return document;
  }

  async store(documentName: string, document: Y.Doc) {
    await this.connect();
    await this.redis.set(
      key(documentName),
      Buffer.from(Y.encodeStateAsUpdate(document)),
      "EX",
      60 * 60 * 24,
    );
  }

  async publish(documentName: string, update: Uint8Array) {
    await this.connect();
    await this.redis.publish(
      key(documentName),
      Buffer.from(update).toString("base64"),
    );
  }

  async setPresence(
    documentName: string,
    connectionId: string,
    value: Record<string, unknown>,
  ) {
    await this.connect();
    await this.redis.hset(
      presenceKey(documentName),
      connectionId,
      JSON.stringify(value),
    );
    await this.redis.expire(presenceKey(documentName), 120);
  }

  async removePresence(documentName: string, connectionId: string) {
    await this.connect();
    await this.redis.hdel(presenceKey(documentName), connectionId);
  }

  async listPresence(documentName: string) {
    await this.connect();
    return (await this.redis.hvals(presenceKey(documentName))).flatMap(
      (value) => {
        try {
          return [JSON.parse(value) as Record<string, unknown>];
        } catch {
          return [];
        }
      },
    );
  }

  async close() {
    await this.redis.quit();
  }
}
