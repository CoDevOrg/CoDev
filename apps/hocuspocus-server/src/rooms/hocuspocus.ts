import { Database } from "@hocuspocus/extension-database";
import { Logger } from "@hocuspocus/extension-logger";
import { Server } from "@hocuspocus/server";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface HocuspocusDocumentStore {
  load(documentName: string): Promise<Uint8Array | null>;
  store(documentName: string, state: Uint8Array): Promise<void>;
}

export type WorkspaceAuthenticator = (input: {
  token: string | null;
  documentName: string;
}) => Promise<{
  workspaceId: string;
  userId: string;
  userName: string;
  canEdit: boolean;
  expiresAt: number;
} | null>;

const workspaceFileDocumentPattern = /^workspace:([0-9a-f-]{36}):(.+)$/i;

export function workspaceFileDocumentWorkspaceId(documentName: string) {
  const match = workspaceFileDocumentPattern.exec(documentName);
  if (!match?.[1] || match[2]?.toLowerCase() === "state") return null;
  return match[1];
}

export function verifyWorkspaceToken(
  token: string | null,
  tokenSecret = process.env.HOCUSPOCUS_TOKEN_SECRET,
) {
  const secret = tokenSecret;
  if (!secret || !token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      workspaceId?: unknown;
      userId?: unknown;
      userName?: unknown;
      canEdit?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof value.workspaceId !== "string" ||
      typeof value.userId !== "string" ||
      typeof value.userName !== "string" ||
      typeof value.canEdit !== "boolean" ||
      typeof value.expiresAt !== "number" ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now()
    ) {
      return null;
    }
    return {
      workspaceId: value.workspaceId,
      userId: value.userId,
      userName: value.userName,
      canEdit: value.canEdit,
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

export function createHocuspocusServer(
  store: HocuspocusDocumentStore,
  authenticate: WorkspaceAuthenticator,
) {
  async function authenticateWorkspace(input: {
    token: string | null;
    documentName: string;
    connectionConfig: { readOnly: boolean };
    connection?: { readOnly: boolean };
  }) {
    const user = await authenticate({
      token: input.token,
      documentName: input.documentName,
    });
    const workspaceId = workspaceFileDocumentWorkspaceId(input.documentName);
    if (!user || !workspaceId || user.workspaceId !== workspaceId) {
      throw new Error("Workspace authentication failed.");
    }
    input.connectionConfig.readOnly = !user.canEdit;
    if (input.connection) input.connection.readOnly = !user.canEdit;
    return user;
  }

  return new Server({
    name: "codev-hocuspocus",
    extensions: [
      new Logger(),
      new Database({
        fetch: async ({ documentName }) => store.load(documentName),
        store: async ({ documentName, state }) =>
          store.store(documentName, state),
      }),
    ],
    async onAuthenticate({ token, documentName, connectionConfig }) {
      return authenticateWorkspace({
        token: token ?? null,
        documentName,
        connectionConfig,
      });
    },
    async onTokenSync({ token, documentName, connectionConfig, connection }) {
      return authenticateWorkspace({
        token: token ?? null,
        documentName,
        connectionConfig,
        connection,
      });
    },
    async connected({ connection, context }) {
      const expiresAt =
        typeof context?.expiresAt === "number" ? context.expiresAt : null;
      if (!expiresAt) return;

      const delay = Math.max(0, expiresAt - Date.now());
      const expiryTimer = setTimeout(() => {
        connection.close({
          code: 4401,
          reason: "Workspace collaboration token expired.",
        });
      }, delay);
      expiryTimer.unref?.();
      connection.onClose(() => clearTimeout(expiryTimer));
    },
  });
}
