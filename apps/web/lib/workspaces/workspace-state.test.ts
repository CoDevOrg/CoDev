import { describe, expect, it } from "vitest";

import { createAgentEvent } from "@codev/shared-types";

import {
  decodeWorkspaceStateEvents,
  encodeWorkspaceStateEvents,
  workspaceStateDocumentName,
} from "./workspace-state";

const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
const actor = {
  userId: workspaceId,
  userName: "Ada",
  avatarUrl: null,
};

function event(type: "USER_PROMPT" | "FILE_DIFF_PROPOSED", timestamp: number) {
  return createAgentEvent({
    workspaceId,
    sessionId: null,
    turnId: null,
    actor,
    modelProvider: "openai",
    modelName: "gpt-5",
    type,
    timestamp,
    payload:
      type === "USER_PROMPT"
        ? { promptText: "Inspect the app" }
        : { filePath: "src/app.tsx", diffContent: "+ready" },
  });
}

describe("workspace Yjs state journal", () => {
  it("uses a stable workspace document name", () => {
    expect(workspaceStateDocumentName(workspaceId)).toBe(
      `workspace:${workspaceId}:state`,
    );
  });

  it("round-trips canonical prompt and diff events as binary state", () => {
    const later = event("FILE_DIFF_PROPOSED", 20);
    const earlier = event("USER_PROMPT", 10);
    const state = encodeWorkspaceStateEvents([later, earlier]);

    expect(state).toBeInstanceOf(Uint8Array);
    expect(state.byteLength).toBeGreaterThan(0);
    expect(decodeWorkspaceStateEvents(state)).toEqual([earlier, later]);
  });
});
