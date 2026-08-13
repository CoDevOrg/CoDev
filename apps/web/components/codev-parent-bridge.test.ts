import { describe, expect, it } from "vitest";

import {
  EMPTY_CODEV_PARENT_BRIDGE_SESSION,
  isCodevBridgeClientMessage,
  replyToCodevBridgeMessage,
} from "./codev-parent-bridge";

describe("codev parent bridge", () => {
  it("acks a workspace-bound hello and answers matching pings", () => {
    const hello = replyToCodevBridgeMessage(EMPTY_CODEV_PARENT_BRIDGE_SESSION, {
      type: "codev:bridge-hello",
      generation: 1,
    });

    expect(hello.reply).toEqual({
      type: "codev:bridge-hello-ack",
      generation: 1,
      workspaceBound: true,
    });

    const ping = replyToCodevBridgeMessage(hello.session, {
      type: "codev:bridge-ping",
      generation: 1,
    });
    expect(ping.reply).toEqual({ type: "codev:bridge-pong", generation: 1 });
  });

  it("stops ponging after interrupt until the next hello", () => {
    const connected = replyToCodevBridgeMessage(
      EMPTY_CODEV_PARENT_BRIDGE_SESSION,
      { type: "codev:bridge-hello", generation: 2 },
    ).session;
    const interrupted = replyToCodevBridgeMessage(connected, {
      type: "codev:bridge-interrupt",
      generation: 2,
    });

    expect(interrupted.session).toEqual({ open: false, generation: 2 });
    expect(
      replyToCodevBridgeMessage(interrupted.session, {
        type: "codev:bridge-ping",
        generation: 2,
      }).reply,
    ).toBeNull();

    const recovered = replyToCodevBridgeMessage(interrupted.session, {
      type: "codev:bridge-hello",
      generation: 3,
    });
    expect(recovered.reply).toEqual({
      type: "codev:bridge-hello-ack",
      generation: 3,
      workspaceBound: true,
    });
  });

  it("rejects untyped or credential-shaped payloads", () => {
    expect(isCodevBridgeClientMessage({ token: "secret" })).toBe(false);
    expect(
      isCodevBridgeClientMessage({
        type: "codev:bridge-hello",
        generation: 0,
      }),
    ).toBe(false);
    expect(
      isCodevBridgeClientMessage({
        type: "codev:bridge-hello",
        generation: 1,
      }),
    ).toBe(true);
  });
});
