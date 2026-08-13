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

export const EMPTY_CODEV_PARENT_BRIDGE_SESSION: CodevParentBridgeSession = {
  open: false,
  generation: null,
};

function isGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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
