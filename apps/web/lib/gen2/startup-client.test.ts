// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { Gen2WorkspaceDetail } from "@codev/contracts";

import { ensureGen2WorkspaceReady } from "./startup-client";

function workspace(
  status: Gen2WorkspaceDetail["status"],
  sandboxId: string | null = null,
) {
  return {
    id: "workspace-1",
    name: "Studio",
    status,
    sandboxId,
    lastError: null,
    role: "owner",
    repository: null,
    repositoryPrivate: false,
    defaultBranch: null,
    createdAt: "2026-09-20T20:00:00.000Z",
    updatedAt: "2026-09-20T20:00:00.000Z",
    members: [],
  } as Gen2WorkspaceDetail;
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchSequence(responses: Response[]) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
    });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected request");
    return next;
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("Gen 2 workspace startup polling", () => {
  it("retries bounded host-wake failures until the server returns ready", async () => {
    const { calls, fetcher } = fetchSequence([
      response(503, { error: "The Firecracker host is still starting." }),
      response(200, { workspace: workspace("ready", "sandbox-1") }),
    ]);
    const pause = vi.fn(async () => {});

    const result = await ensureGen2WorkspaceReady("workspace-1", {
      fetcher,
      pause,
      random: () => 0.5,
    });

    expect(result.workspace?.sandboxId).toBe("sandbox-1");
    expect(calls).toEqual([
      { url: "/api/gen2/workspaces/workspace-1/instance", method: "POST" },
      { url: "/api/gen2/workspaces/workspace-1/instance", method: "POST" },
    ]);
    expect(pause).toHaveBeenCalledOnce();
  });

  it("joins another member's startup by polling persisted workspace state", async () => {
    const { calls, fetcher } = fetchSequence([
      response(202, { workspace: workspace("provisioning") }),
      response(200, { workspace: workspace("provisioning") }),
      response(200, { workspace: workspace("ready", "sandbox-1") }),
    ]);
    const pause = vi.fn(async () => {});

    const result = await ensureGen2WorkspaceReady("workspace-1", {
      fetcher,
      pause,
      random: () => 0.5,
    });

    expect(result.workspace?.status).toBe("ready");
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET", "GET"]);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("restarts startup when the previous host-wake attempt returns to pending", async () => {
    const { calls, fetcher } = fetchSequence([
      response(202, { workspace: workspace("provisioning") }),
      response(200, { workspace: workspace("pending") }),
      response(200, { workspace: workspace("ready", "sandbox-1") }),
    ]);

    const result = await ensureGen2WorkspaceReady("workspace-1", {
      fetcher,
      pause: async () => {},
      random: () => 0.5,
    });

    expect(result.workspace?.status).toBe("ready");
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET", "POST"]);
  });

  it("surfaces non-retryable startup failures for the existing retry action", async () => {
    const { fetcher } = fetchSequence([
      response(502, { error: "Firecracker guest creation failed." }),
    ]);

    await expect(
      ensureGen2WorkspaceReady("workspace-1", { fetcher }),
    ).resolves.toEqual({ error: "Firecracker guest creation failed." });
  });

  it("stops retrying after the bounded client wait", async () => {
    let clock = 0;
    const { calls, fetcher } = fetchSequence([
      response(503, { error: "The Firecracker host is still starting." }),
      response(503, { error: "The Firecracker host is still starting." }),
      response(503, { error: "The Firecracker host is still starting." }),
    ]);

    const result = await ensureGen2WorkspaceReady("workspace-1", {
      fetcher,
      maxWaitMs: 5_000,
      now: () => clock,
      pause: async (milliseconds) => {
        clock += milliseconds;
      },
      random: () => 0.5,
    });

    expect(result).toEqual({
      error: "The Firecracker host is still starting. Try again in a moment.",
    });
    expect(calls).toHaveLength(2);
  });
});
