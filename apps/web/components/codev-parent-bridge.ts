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
  | "members.update"
  | "presence.list"
  | "presence.update"
  | "presence.cursor.update"
  | "conflicts.list"
  | "conflicts.report"
  | "conflicts.resolve"
  | "agents.list"
  | "agents.enqueue"
  | "agents.interrupt"
  | "agents.startControlled"
  | "agents.selectProvider"
  | "workboard.list"
  | "workboard.create"
  | "claims.list"
  | "claims.create"
  | "claims.reassign"
  | "claims.cancel"
  | "review.list"
  | "review.prepare"
  | "review.advance"
  | "review.merge"
  | "activity.list"
  | "connections.list"
  | "connections.put"
  | "connections.revoke"
  | "profile.get";

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
  "presence.list",
  "presence.update",
  "presence.cursor.update",
  "conflicts.list",
  "conflicts.report",
  "conflicts.resolve",
  "agents.list",
  "agents.enqueue",
  "agents.interrupt",
  "agents.startControlled",
  "agents.selectProvider",
  "workboard.list",
  "workboard.create",
  "claims.list",
  "claims.create",
  "claims.reassign",
  "claims.cancel",
  "review.list",
  "review.prepare",
  "review.advance",
  "review.merge",
  "activity.list",
  "connections.list",
  "connections.put",
  "connections.revoke",
  "profile.get",
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
    if (request.method === "presence.list") {
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/presence`,
        { cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(jsonError(payload, "CoDev could not load presence."));
      }
      return succeed(payload);
    }

    if (request.method === "conflicts.list") {
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/collaboration/conflicts`,
        { cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(jsonError(payload, "CoDev could not load file conflicts."));
      }
      return succeed(payload);
    }

    if (request.method === "conflicts.report") {
      const path = request.params?.path;
      const collaborativeContents = request.params?.collaborativeContents;
      if (typeof path !== "string" || !path.trim()) {
        return fail("A workspace-relative file path is required.");
      }
      if (typeof collaborativeContents !== "string") {
        return fail("The collaborative editor contents are required.");
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/collaboration/conflicts`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, collaborativeContents }),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not record this file conflict."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "agents.list") {
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/shared`,
        { cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not load shared agent sessions."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "agents.startControlled") {
      const sessionId = request.params?.sessionId;
      if (typeof sessionId !== "string" || !INVITE_ID.test(sessionId)) {
        return fail("A valid agent session is required.");
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/${sessionId}/controlled`,
        { method: "POST" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not start this controlled turn."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "agents.selectProvider") {
      const sessionId = request.params?.sessionId;
      const provider = request.params?.provider;
      if (typeof sessionId !== "string" || !INVITE_ID.test(sessionId)) {
        return fail("A valid agent session is required.");
      }
      if (provider !== "openai" && provider !== "restricted") {
        return fail("Choose OpenAI or the restricted fixture provider.");
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/${sessionId}/provider`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider }),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not select this provider."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "agents.enqueue") {
      const sessionId = request.params?.sessionId;
      const prompt = request.params?.prompt;
      if (typeof sessionId !== "string" || !INVITE_ID.test(sessionId)) {
        return fail("A valid agent session is required.");
      }
      if (typeof prompt !== "string" || !prompt.trim()) {
        return fail("An instruction is required.");
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/${sessionId}/queue`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim() }),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not queue this instruction."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "agents.interrupt") {
      const sessionId = request.params?.sessionId;
      if (typeof sessionId !== "string" || !INVITE_ID.test(sessionId)) {
        return fail("A valid agent session is required.");
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/${sessionId}/interrupt`,
        { method: "POST" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not interrupt this agent turn."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "workboard.list") {
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/workboard`,
        { cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not load the agent workboard."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "workboard.create") {
      const createResponse = await fetcher(
        `/api/workspaces/${workspaceId}/agents`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Managed proposal",
            draft: true,
            attachments: [],
          }),
        },
      );
      const createPayload = await readJson(createResponse);
      const workboardResponse = await fetcher(
        `/api/workspaces/${workspaceId}/agents/workboard`,
        { cache: "no-store" },
      );
      const workboardPayload = await readJson(workboardResponse);
      if (!workboardResponse.ok) {
        if (!createResponse.ok) {
          return fail(
            jsonError(
              createPayload,
              "CoDev could not start this agent session.",
            ),
          );
        }
        return fail(
          jsonError(
            workboardPayload,
            "CoDev could not load the agent workboard.",
          ),
        );
      }
      if (createResponse.status === 409) {
        return succeed({
          ...workboardPayload,
          created: null,
          rejection: {
            status: 409,
            title: "Server rejected the fourth session · HTTP 409",
            message: jsonError(
              createPayload,
              "All three agent slots are in use. Stop or wait for an active session to finish before starting another.",
            ),
          },
        });
      }
      if (!createResponse.ok) {
        return fail(
          jsonError(createPayload, "CoDev could not start this agent session."),
        );
      }
      const sessionId =
        createPayload &&
        typeof createPayload === "object" &&
        "sessionId" in createPayload &&
        typeof createPayload.sessionId === "string"
          ? createPayload.sessionId
          : null;
      const worktreeId =
        createPayload &&
        typeof createPayload === "object" &&
        "worktreeId" in createPayload &&
        typeof createPayload.worktreeId === "string"
          ? createPayload.worktreeId
          : null;
      return succeed({
        ...workboardPayload,
        created: sessionId && worktreeId ? { sessionId, worktreeId } : null,
        rejection: null,
      });
    }

    if (request.method === "connections.list") {
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/connections`,
        { cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not load provider connections."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "connections.put") {
      const provider = request.params?.provider;
      const apiKey = request.params?.apiKey;
      if (provider !== "openai" && provider !== "anthropic") {
        return fail("Choose OpenAI or Anthropic.");
      }
      if (typeof apiKey !== "string" || apiKey.trim().length < 20) {
        return fail("Enter a valid API key.");
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/connections`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider, apiKey: apiKey.trim() }),
          cache: "no-store",
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not save this provider connection."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "connections.revoke") {
      const provider = request.params?.provider;
      if (provider !== "openai" && provider !== "anthropic") {
        return fail("Choose OpenAI or Anthropic.");
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/connections?provider=${provider}`,
        { method: "DELETE", cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(
            payload,
            "CoDev could not revoke this provider connection.",
          ),
        );
      }
      return succeed(payload);
    }

    if (request.method === "activity.list") {
      const params = new URLSearchParams();
      if (
        request.params?.kind === "file" ||
        request.params?.kind === "session" ||
        request.params?.kind === "diff"
      ) {
        params.set("kind", request.params.kind);
      }
      if (
        typeof request.params?.query === "string" &&
        request.params.query.trim()
      ) {
        params.set("query", request.params.query.trim());
      }
      const query = params.toString();
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/events${query ? `?${query}` : ""}`,
        { cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not load workspace activity."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "review.list") {
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/reviews`,
        { cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not load review checkpoints."),
        );
      }
      return succeed(payload);
    }

    if (
      request.method === "review.prepare" ||
      request.method === "review.advance" ||
      request.method === "review.merge"
    ) {
      const action =
        request.method === "review.advance"
          ? "advance"
          : request.method === "review.merge"
            ? "merge"
            : "prepare";
      const sessionId = request.params?.sessionId;
      if (
        action !== "advance" &&
        (typeof sessionId !== "string" || !INVITE_ID.test(sessionId))
      ) {
        return fail("A valid agent session is required.");
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/reviews`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            action === "advance" ? { action } : { action, sessionId },
          ),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(
            payload,
            action === "merge"
              ? "CoDev could not integrate this review checkpoint."
              : action === "advance"
                ? "CoDev could not advance the integration head."
                : "CoDev could not prepare this review checkpoint.",
          ),
        );
      }
      return succeed(payload);
    }

    if (request.method === "claims.list") {
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/claims`,
        { cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(jsonError(payload, "CoDev could not load path claims."));
      }
      return succeed(payload);
    }

    if (request.method === "claims.create") {
      const sessionId = request.params?.sessionId;
      if (typeof sessionId !== "string" || !INVITE_ID.test(sessionId)) {
        return fail("A valid agent session is required.");
      }
      const body: {
        sessionId: string;
        contest?: boolean;
        path?: string;
        intent?: string;
        revision?: string;
      } = { sessionId };
      if (typeof request.params?.contest === "boolean") {
        body.contest = request.params.contest;
      }
      if (
        typeof request.params?.path === "string" &&
        request.params.path.trim()
      ) {
        body.path = request.params.path.trim();
      }
      if (
        typeof request.params?.intent === "string" &&
        request.params.intent.trim()
      ) {
        body.intent = request.params.intent.trim();
      }
      if (
        typeof request.params?.revision === "string" &&
        request.params.revision.trim()
      ) {
        body.revision = request.params.revision.trim();
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/claims`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(
            payload,
            request.params?.contest
              ? "CoDev could not contest this path claim."
              : "CoDev could not create this path claim.",
          ),
        );
      }
      return succeed(payload);
    }

    if (
      request.method === "claims.reassign" ||
      request.method === "claims.cancel"
    ) {
      const claimId = request.params?.claimId;
      if (typeof claimId !== "string" || !INVITE_ID.test(claimId)) {
        return fail("A valid path claim is required.");
      }
      const action =
        request.method === "claims.reassign" ? "reassign" : "cancel";
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/agents/claims/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ claimId }),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(
            payload,
            action === "reassign"
              ? "CoDev could not reassign this path claim."
              : "CoDev could not cancel this path claim.",
          ),
        );
      }
      return succeed(payload);
    }

    if (request.method === "conflicts.resolve") {
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/collaboration/conflicts/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request.params ?? {}),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not resolve this file conflict."),
        );
      }
      return succeed(payload);
    }

    if (
      request.method === "presence.update" ||
      request.method === "presence.cursor.update"
    ) {
      const path = request.params?.path;
      if (typeof path !== "string" || !path.trim()) {
        return fail("A workspace-relative active file is required.");
      }
      const body: { path: string; cursor?: { anchor: number; head: number } } =
        { path };
      if (request.method === "presence.cursor.update") {
        const cursor = request.params?.cursor;
        if (
          !cursor ||
          typeof cursor !== "object" ||
          typeof (cursor as { anchor?: unknown }).anchor !== "number" ||
          !Number.isInteger((cursor as { anchor: number }).anchor) ||
          (cursor as { anchor: number }).anchor < 0 ||
          typeof (cursor as { head?: unknown }).head !== "number" ||
          !Number.isInteger((cursor as { head: number }).head) ||
          (cursor as { head: number }).head < 0
        ) {
          return fail("A valid editor cursor is required.");
        }
        body.cursor = cursor as { anchor: number; head: number };
      }
      const response = await fetcher(
        `/api/workspaces/${workspaceId}/presence`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(jsonError(payload, "CoDev could not update presence."));
      }
      return succeed(payload);
    }

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

/** Bridge methods reachable from the personal settings surface. */
const PERSONAL_BRIDGE_METHODS = new Set<CodevBridgeMethod>([
  "connections.list",
  "connections.put",
  "connections.revoke",
  "profile.get",
]);

/**
 * Bridge executor for the personal settings surface. There is no workspace in
 * context, so this deliberately denies every workspace-scoped method and
 * serves only the member's own provider connections from `/api/personal/*`.
 */
export async function executePersonalCodevBridgeRequest(
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
  if (!PERSONAL_BRIDGE_METHODS.has(request.method)) {
    return fail("This setting is only available inside a workspace.");
  }

  try {
    if (request.method === "connections.list") {
      const response = await fetcher("/api/personal/connections", {
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not load provider connections."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "connections.put") {
      const provider = request.params?.provider;
      const apiKey = request.params?.apiKey;
      if (provider !== "openai" && provider !== "anthropic") {
        return fail("Choose OpenAI or Anthropic.");
      }
      if (typeof apiKey !== "string" || apiKey.trim().length < 20) {
        return fail("Enter a valid API key.");
      }
      const response = await fetcher("/api/personal/connections", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey: apiKey.trim() }),
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(payload, "CoDev could not save this provider connection."),
        );
      }
      return succeed(payload);
    }

    if (request.method === "connections.revoke") {
      const provider = request.params?.provider;
      if (provider !== "openai" && provider !== "anthropic") {
        return fail("Choose OpenAI or Anthropic.");
      }
      const response = await fetcher(
        `/api/personal/connections?provider=${provider}`,
        { method: "DELETE", cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(
          jsonError(
            payload,
            "CoDev could not revoke this provider connection.",
          ),
        );
      }
      return succeed(payload);
    }

    if (request.method === "profile.get") {
      const response = await fetcher("/api/personal/profile", {
        cache: "no-store",
      });
      const payload = await readJson(response);
      if (!response.ok) {
        return fail(jsonError(payload, "CoDev could not load your profile."));
      }
      return succeed(payload);
    }

    return fail("This setting is only available inside a workspace.");
  } catch (error) {
    return fail(
      error instanceof Error
        ? error.message
        : "CoDev could not complete this request.",
    );
  }
}
