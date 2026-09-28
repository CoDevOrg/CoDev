import { beforeEach, describe, expect, it } from "vitest";

import { handleFakeGuestRequest, resetFakeGuest } from "./fake-guest";

const workspaceId = "123e4567-e89b-42d3-a456-426614174000";
const memberA = "123e4567-e89b-42d3-a456-426614174001";
const memberB = "123e4567-e89b-42d3-a456-426614174002";
const path = (operation: string) =>
  `/v1/sandboxes/${workspaceId}/superset/runtime/session/${operation}`;

async function request(operation: string, body: object) {
  const response = handleFakeGuestRequest("POST", path(operation), body);
  if (!response)
    throw new Error("Fake guest did not handle the session operation.");
  return { status: response.status, body: await response.json() };
}

describe("fake guest Superset session contract", () => {
  beforeEach(() => {
    resetFakeGuest();
    handleFakeGuestRequest("POST", "/v1/sandboxes", { workspaceId });
  });

  it("creates, prompts, and replays durable events", async () => {
    const created = await request("create", { memberId: memberA });
    expect(created.status).toBe(200);
    const sessionId = created.body.sessionId as string;
    await request("prompt", {
      memberId: memberA,
      sessionId,
      text: "Explain this repo",
    });
    const live = await request("events", { memberId: memberA, sessionId });
    expect(live.body.envelopes).toHaveLength(3);
    expect(live.body.envelopes[1].event.turn.status).toBe("running");
    expect(Object.values(live.body.liveText)[0]).toContain("Local Superset");
    const completed = await request("events", { memberId: memberA, sessionId });
    expect(completed.body.envelopes[4].event.turn.status).toBe("completed");
    expect(completed.body.envelopes[3].event.item.text).toContain(
      "Explain this repo",
    );
  });

  it("does not list or open another member's session", async () => {
    const created = await request("create", { memberId: memberA });
    const sessionId = created.body.sessionId as string;
    const list = await request("list", { memberId: memberB });
    expect(list.body.sessions).toEqual([]);
    const events = await request("events", { memberId: memberB, sessionId });
    expect(events.status).toBe(404);
  });

  it("cancels a running turn without completing its pending reply", async () => {
    const created = await request("create", { memberId: memberA });
    const sessionId = created.body.sessionId as string;
    await request("prompt", {
      memberId: memberA,
      sessionId,
      text: "Long task",
    });
    const canceled = await request("cancel", { memberId: memberA, sessionId });
    expect(canceled.status).toBe(200);
    const events = await request("events", { memberId: memberA, sessionId });
    expect(events.body.envelopes.at(-1).event.turn.status).toBe("interrupted");
    expect(events.body.liveText).toEqual({});
  });
});
