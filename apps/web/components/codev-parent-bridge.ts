export type CodevParentBridgeSession = {
  open: boolean;
  generation: number | null;
};

export type CodevBridgeClientMessage =
  | { type: "codev:bridge-hello"; generation: number }
  | { type: "codev:bridge-ping"; generation: number }
  | { type: "codev:bridge-interrupt"; generation: number };

export type CodevBridgeParentMessage =
  | { type: "codev:bridge-hello-ack"; generation: number; workspaceBound: true }
  | { type: "codev:bridge-pong"; generation: number };

export type CodevBridgeMethod =
  | "invites.list"
  | "invites.create"
  | "invites.revoke"
  | "members.update";

export type CodevBridgeRequestMessage = {
  type: "codev:bridge-request";
  generation: number;
  requestId: string;
  method: CodevBridgeMethod;
  params?: Record<string, unknown>;
};

export type CodevBridgeResponseMessage = {
  type: "codev:bridge-response";
  generation: number;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export const EMPTY_CODEV_PARENT_BRIDGE_SESSION: CodevParentBridgeSession = {
  open: false,
  generation: null,
};

const INVITE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_ROLES = ["co_steer", "reviewer", "viewer"] as const;
const BRIDGE_METHODS = new Set<CodevBridgeMethod>([
  "invites.list",
  "invites.create",
  "invites.revoke",
  "members.update",
]);
const CREDENTIAL_KEYS = new Set([
  "token",
  "password",
  "authorization",
  "cookie",
  "secret",
  "credential",
]);

function isGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export function isCodevBridgeClientMessage(
  data: unknown,
): data is CodevBridgeClientMessage {
  if (!data || typeof data !== "object" || !("type" in data)) {
    return false;
  }
  const message = data as { type?: unknown; generation?: unknown };
  if (
    message.type !== "codev:bridge-hello" &&
    message.type !== "codev:bridge-ping" &&
    message.type !== "codev:bridge-interrupt"
  ) {
    return false;
  }
  return isGeneration(message.generation);
}

export function isCodevBridgeRequestMessage(
  data: unknown,
): data is CodevBridgeRequestMessage {
  if (!data || typeof data !== "object" || !("type" in data)) {
    return false;
  }
  const message = data as {
    type?: unknown;
    generation?: unknown;
    requestId?: unknown;
    method?: unknown;
    params?: unknown;
  };
  if (message.type !== "codev:bridge-request") {
    return false;
  }
  if (!isGeneration(message.generation) || !isRequestId(message.requestId)) {
    return false;
  }
  if (
    typeof message.method !== "string" ||
    !BRIDGE_METHODS.has(message.method as CodevBridgeMethod)
  ) {
    return false;
  }
  if (message.params === undefined) {
    return true;
  }
  if (!message.params || typeof message.params !== "object") {
    return false;
  }
  return !Object.keys(message.params).some((key) =>
    CREDENTIAL_KEYS.has(key.toLowerCase()),
  );
}

export function replyToCodevBridgeMessage(
  session: CodevParentBridgeSession,
  data: CodevBridgeClientMessage,
): {
  session: CodevParentBridgeSession;
  reply: CodevBridgeParentMessage | null;
} {
  if (data.type === "codev:bridge-hello") {
    return {
      session: { open: true, generation: data.generation },
      reply: {
        type: "codev:bridge-hello-ack",
        generation: data.generation,
        workspaceBound: true,
      },
    };
  }
  if (data.type === "codev:bridge-interrupt") {
    if (!session.open || session.generation !== data.generation) {
      return { session, reply: null };
    }
    return {
      session: { open: false, generation: data.generation },
      reply: null,
    };
  }
  if (
    !session.open ||
    session.generation !== data.generation ||
    data.type !== "codev:bridge-ping"
  ) {
    return { session, reply: null };
  }
  return {
    session,
    reply: { type: "codev:bridge-pong", generation: data.generation },
  };
}

function jsonError(payload: { error?: unknown } | null, fallback: string) {
  return typeof payload?.error === "string" ? payload.error : fallback;
}

async function readJson(
  response: Response,
): Promise<{ error?: unknown } | Record<string, unknown> | null> {
  return (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
}

export async function executeCodevBridgeRequest(
  workspaceId: string,
  request: CodevBridgeRequestMessage,
  session: CodevParentBridgeSession,
  fetcher: typeof fetch = fetch,
): Promise<CodevBridgeResponseMessage> {
  const fail = (error: string): CodevBridgeResponseMessage => ({
    type: "codev:bridge-response",
    generation: request.generation,
    requestId: request.requestId,
    ok: false,
    error,
  });
  const succeed = (result: unknown): CodevBridgeResponseMessage => ({
    type: "codev:bridge-response",
    generation: request.generation,
    requestId: request.requestId,
    ok: true,
    result,
  });

  if (!session.open || session.generation !== request.generation) {
    return fail("CoDev bridge is not connected.");
  }

  try {
    if (request.method === "invites.list") {
      const response = await fetcher(`/api/workspaces/${workspaceId}/invites`, {
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(jsonError(payload, "CoDev could not load invites."));
      }
      return succeed(payload);
    }

    if (request.method === "invites.create") {
      const params = request.params ?? {};
      const body: { accessRole?: string; invitee?: string } = {};
      if (
        typeof params.accessRole === "string" &&
        ACCESS_ROLES.includes(
          params.accessRole as (typeof ACCESS_ROLES)[number],
        )
      ) {
        body.accessRole = params.accessRole;
      }
      if (typeof params.invitee === "string" && params.invitee.trim()) {
        body.invitee = params.invitee.trim();
      }
      const response = await fetcher(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(jsonError(payload, "CoDev could not create this invite."));
      }
      return succeed(payload);
    }

    if (request.method === "members.update") {
      const memberUserId = request.params?.memberUserId;
      const accessRole = request.params?.accessRole;
      if (typeof memberUserId !== "string" || !INVITE_ID.test(memberUserId)) {
        return fail("A valid workspace member is required.");
      }
      if (
        typeof accessRole !== "string" ||
        !ACCESS_ROLES.includes(accessRole as (typeof ACCESS_ROLES)[number])
      ) {
        return fail("A valid member role is required.");
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/members/${memberUserId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessRole }),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(jsonError(payload, "CoDev could not update this member."));
      }
      return succeed(payload);
    }

    const inviteId = request.params?.inviteId;
    if (typeof inviteId !== "string" || !INVITE_ID.test(inviteId)) {
      return fail("A valid invite is required.");
    }
    const revokeResponse = await fetcher(
      `/api/workspaces/${workspaceId}/invites/${inviteId}`,
      { method: "DELETE" },
    );
    if (!revokeResponse.ok && revokeResponse.status !== 204) {
      const payload = await readJson(revokeResponse);
      return fail(jsonError(payload, "CoDev could not revoke this invite."));
    }
    const listResponse = await fetcher(
      `/api/workspaces/${workspaceId}/invites`,
      { cache: "no-store" },
    );
    const listPayload = await readJson(listResponse);
    if (!listResponse.ok) {
      return fail(jsonError(listPayload, "CoDev could not load invites."));
    }
    return succeed({
      ...(listPayload && typeof listPayload === "object" ? listPayload : {}),
      revokedInviteId: inviteId,
    });
  } catch (error) {
    return fail(
      error instanceof Error
        ? error.message
        : "CoDev could not complete this invite request.",
    );
  }
}
