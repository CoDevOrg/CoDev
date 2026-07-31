import { and, eq, sql } from "drizzle-orm";
import * as Y from "yjs";

import { createDatabase, schema } from "@codev/db";

function workspaceIdFromDocument(documentName: string) {
  const match = /^workspace:([0-9a-f-]{36})(?::|$)/i.exec(documentName);
  if (!match?.[1]) throw new Error("Invalid Hocuspocus document name.");
  return match[1];
}

export function mergeYjsState(
  current: Uint8Array | Buffer | null | undefined,
  incoming: Uint8Array,
) {
  const document = new Y.Doc();
  if (current && current.byteLength > 0) {
    Y.applyUpdate(document, new Uint8Array(current), "postgres");
  }
  Y.applyUpdate(document, incoming, "hocuspocus");
  return Buffer.from(Y.encodeStateAsUpdate(document));
}

export class PostgresDocumentStore {
  private readonly client: ReturnType<typeof createDatabase>;

  constructor(
    connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
  ) {
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for Hocuspocus.");
    }
    this.client = createDatabase(connectionString);
  }

  async load(documentName: string) {
    const workspaceId = workspaceIdFromDocument(documentName);
    const [document] = await this.client.db
      .select({ state: schema.workspaceStateDocuments.state })
      .from(schema.workspaceStateDocuments)
      .where(
        and(
          eq(schema.workspaceStateDocuments.documentName, documentName),
          eq(schema.workspaceStateDocuments.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return document?.state ?? null;
  }

  async store(documentName: string, state: Uint8Array) {
    const workspaceId = workspaceIdFromDocument(documentName);
    await this.client.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`hocuspocus:${documentName}`}))`,
      );
      const [stored] = await transaction
        .select({ state: schema.workspaceStateDocuments.state })
        .from(schema.workspaceStateDocuments)
        .where(
          and(
            eq(schema.workspaceStateDocuments.documentName, documentName),
            eq(schema.workspaceStateDocuments.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      const encoded = mergeYjsState(stored?.state, state);
      const now = new Date();
      await transaction
        .insert(schema.workspaceStateDocuments)
        .values({ documentName, workspaceId, state: encoded, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.workspaceStateDocuments.documentName,
          set: { state: encoded, updatedAt: now },
        });
    });
  }

  async ping() {
    await this.client.pool.query("select 1");
  }

  async close() {
    await this.client.pool.end();
  }
}
