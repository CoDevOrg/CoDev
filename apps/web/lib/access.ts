import "server-only";

import { and, eq } from "drizzle-orm";

import { schema } from "@codev/db";
import {
  workspaceRoleCapabilities,
  type WorkspaceRole,
} from "@codev/contracts";

import { getDatabase } from "./database";

export type WorkspaceAccessRole = "owner" | "co_steer" | "reviewer" | "viewer";
export type WorkspacePermission =
  | "view"
  | "edit"
  | "coSteer"
  | "review"
  | "terminal"
  | "terminalWrite"
  | "merge"
  | "invite";

export type OpenFgaWorkspaceRelation =
  | "viewer"
  | "reviewer"
  | "editor"
  | "owner";

export function openFgaRelationForPermission(
  permission: WorkspacePermission,
): "viewer" | "reviewer" | "editor" | "owner" {
  switch (permission) {
    case "view":
      return "viewer";
    case "terminal":
      return "reviewer";
    case "review":
      return "reviewer";
    case "edit":
    case "coSteer":
    case "terminalWrite":
    case "merge":
      return "editor";
    case "invite":
      return "owner";
  }
}

function openFgaRelationForRole(
  role: WorkspaceAccessRole,
): "viewer" | "reviewer" | "editor" | "owner" {
  switch (role) {
    case "owner":
      return "owner";
    case "co_steer":
      return "editor";
    case "reviewer":
      return "reviewer";
    case "viewer":
      return "viewer";
  }
}

export class WorkspaceAccessError extends Error {
  constructor(
    message = "You do not have permission to perform this workspace action.",
    readonly status = 403,
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

type OpenFgaConfiguration = {
  apiUrl: string;
  storeId: string;
  authorizationModelId: string;
  clientToken: string | undefined;
  apiTokenIssuer: string;
  apiAudience: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
};

type OpenFgaTokenCache = {
  key: string;
  token: string;
  expiresAt: number;
};

let openFgaTokenCache: OpenFgaTokenCache | null = null;

export function permissionsForRole(role: WorkspaceAccessRole) {
  switch (role) {
    case "reviewer":
      return {
        view: true,
        edit: false,
        coSteer: false,
        review: true,
        terminal: true,
        terminalWrite: false,
        merge: false,
        invite: false,
      } as const;
    default: {
      const roleCapabilities =
        workspaceRoleCapabilities[workspaceRoleForAccessRole(role)];
      return {
        view: roleCapabilities.canView,
        edit: roleCapabilities.canEdit,
        coSteer: roleCapabilities.canCoSteer,
        review: roleCapabilities.canEdit,
        terminal: roleCapabilities.canUseTerminal,
        terminalWrite: roleCapabilities.canWriteTerminal,
        merge: roleCapabilities.canApproveIntegration,
        invite: roleCapabilities.canManageMembers,
      } as const;
    }
  }
}

function workspaceRoleForAccessRole(role: WorkspaceAccessRole): WorkspaceRole {
  switch (role) {
    case "owner":
      return "maintainer";
    case "co_steer":
      return "collaborator";
    case "viewer":
      return "viewer";
    case "reviewer":
      return "viewer";
  }
}

function openFgaConfiguration() {
  const apiUrl = process.env.OPENFGA_API_URL?.replace(/\/$/, "");
  const storeId = process.env.OPENFGA_STORE_ID;
  const authorizationModelId = process.env.OPENFGA_AUTHORIZATION_MODEL_ID;
  if (!apiUrl || !storeId || !authorizationModelId) return null;
  return {
    apiUrl,
    storeId,
    authorizationModelId,
    clientToken: process.env.OPENFGA_CLIENT_TOKEN,
    apiTokenIssuer: (
      process.env.OPENFGA_API_TOKEN_ISSUER ?? "https://auth.fga.dev"
    ).replace(/\/$/, ""),
    apiAudience: process.env.OPENFGA_API_AUDIENCE ?? apiUrl + "/",
    clientId: process.env.OPENFGA_CLIENT_ID,
    clientSecret: process.env.OPENFGA_CLIENT_SECRET,
  } satisfies OpenFgaConfiguration;
}

function fgaObject(workspaceId: string) {
  return `workspace:${workspaceId}`;
}

function fgaUser(userId: string) {
  return `user:${userId}`;
}

async function openFgaRequest(path: string, body: Record<string, unknown>) {
  const configuration = openFgaConfiguration();
  if (!configuration) {
    if (process.env.NODE_ENV === "production") {
      throw new WorkspaceAccessError(
        "OpenFGA authorization is not configured.",
        503,
      );
    }
    return null;
  }
  const bearerToken = await openFgaBearerToken(configuration);
  const response = await fetch(
    `${configuration.apiUrl}/stores/${configuration.storeId}${path}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(bearerToken ? { Authorization: "Bearer " + bearerToken } : {}),
      },
      body: JSON.stringify({
        authorization_model_id: configuration.authorizationModelId,
        ...body,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) {
    throw new WorkspaceAccessError(
      `OpenFGA authorization request failed with HTTP ${response.status}.`,
      503,
    );
  }
  return (await response.json()) as { allowed?: boolean };
}

async function openFgaBearerToken(configuration: OpenFgaConfiguration) {
  if (configuration.clientToken) return configuration.clientToken;
  if (!configuration.clientId || !configuration.clientSecret) return null;

  const cacheKey = [
    configuration.apiTokenIssuer,
    configuration.apiAudience,
    configuration.clientId,
  ].join("|");
  if (
    openFgaTokenCache?.key === cacheKey &&
    openFgaTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return openFgaTokenCache.token;
  }

  const response = await fetch(configuration.apiTokenIssuer + "/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      audience: configuration.apiAudience,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new WorkspaceAccessError(
      "OpenFGA token request failed with HTTP " + response.status + ".",
      503,
    );
  }
  const payload = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof payload.access_token !== "string") {
    throw new WorkspaceAccessError(
      "OpenFGA token response did not include an access token.",
      503,
    );
  }

  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 60
      ? payload.expires_in
      : 3_600;
  openFgaTokenCache = {
    key: cacheKey,
    token: payload.access_token,
    expiresAt: Date.now() + (expiresIn - 60) * 1_000,
  };
  return payload.access_token;
}

export async function writeWorkspaceTuple(input: {
  workspaceId: string;
  userId: string;
  role: WorkspaceAccessRole;
  deleteRole?: WorkspaceAccessRole;
}) {
  const writes = [
    {
      user: fgaUser(input.userId),
      relation: input.role === "co_steer" ? "editor" : input.role,
      object: fgaObject(input.workspaceId),
    },
  ];
  const deletes = input.deleteRole
    ? [
        {
          user: fgaUser(input.userId),
          relation:
            input.deleteRole === "co_steer" ? "editor" : input.deleteRole,
          object: fgaObject(input.workspaceId),
        },
      ]
    : [];
  await openFgaRequest("/write", {
    writes: { tuple_keys: writes },
    ...(deletes.length > 0 ? { deletes: { tuple_keys: deletes } } : {}),
  });
}

async function checkOpenFga(
  workspaceId: string,
  userId: string,
  relation: OpenFgaWorkspaceRelation,
) {
  const result = await openFgaRequest("/check", {
    tuple_key: {
      user: fgaUser(userId),
      relation,
      object: fgaObject(workspaceId),
    },
  });
  return result?.allowed ?? true;
}

export async function checkWorkspaceRelation(
  workspaceId: string,
  userId: string,
  relation: OpenFgaWorkspaceRelation,
) {
  return checkOpenFga(workspaceId, userId, relation);
}

export async function getWorkspaceAccess(workspaceId: string, userId: string) {
  const [membership] = await getDatabase()
    .select({
      accessRole: schema.workspaceMembers.accessRole,
      legacyRole: schema.workspaceMembers.role,
      canTerminal: schema.workspaceMembers.canTerminal,
      canMerge: schema.workspaceMembers.canMerge,
    })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) return null;
  const role: WorkspaceAccessRole =
    membership.accessRole ??
    (membership.legacyRole === "owner" ? "owner" : "viewer");
  const permissions = permissionsForRole(role);
  const configured = openFgaConfiguration();
  if (!configured && process.env.NODE_ENV === "production") {
    throw new WorkspaceAccessError(
      "OpenFGA authorization is not configured.",
      503,
    );
  }
  const expectedRelation = openFgaRelationForRole(role);
  if (
    configured &&
    !(await checkOpenFga(workspaceId, userId, expectedRelation))
  ) {
    // PostgreSQL is the durable membership source of truth. Repair tuples for
    // memberships that predate OpenFGA (or were interrupted between the DB
    // write and the FGA write), then require the authorization service to
    // confirm the repaired relationship. A persistent denial still fails
    // closed.
    await writeWorkspaceTuple({ workspaceId, userId, role });
    if (!(await checkOpenFga(workspaceId, userId, expectedRelation))) {
      throw new WorkspaceAccessError("OpenFGA denied workspace access.");
    }
  }

  return {
    role,
    permissions: {
      ...permissions,
      // Legacy flags remain a hard upper bound until all old rows are migrated.
      terminal: permissions.terminal && membership.canTerminal,
      merge: permissions.merge && membership.canMerge,
    },
  };
}

export async function requireWorkspacePermission(
  workspaceId: string,
  userId: string,
  permission: WorkspacePermission,
) {
  const access = await getWorkspaceAccess(workspaceId, userId);
  if (!access) throw new WorkspaceAccessError("Workspace not found.", 404);
  if (!access.permissions[permission]) {
    throw new WorkspaceAccessError();
  }
  if (
    openFgaConfiguration() &&
    !(await checkOpenFga(
      workspaceId,
      userId,
      openFgaRelationForPermission(permission),
    ))
  ) {
    throw new WorkspaceAccessError(
      `OpenFGA denied the ${permission} workspace permission.`,
    );
  }
  return access;
}
