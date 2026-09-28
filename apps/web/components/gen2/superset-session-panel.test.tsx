import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SupersetSessionPanel } from "./superset-session-panel";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

describe("SupersetSessionPanel", () => {
  it("renders a readable label for a persisted Codex config warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/sessions/list")) {
          return new Response(
            JSON.stringify({ sessions: [{ sessionId, status: "idle" }] }),
            { status: 200 },
          );
        }
        if (url.endsWith("/sessions/events")) {
          return new Response(
            JSON.stringify({
              ok: true,
              envelopes: [
                {
                  cursor: { epoch: "epoch-1", seq: 1 },
                  event: {
                    type: "item",
                    item: {
                      id: "notice-1",
                      kind: "notice",
                      text: "configWarning",
                    },
                  },
                },
              ],
              liveText: {},
              nextBefore: null,
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <SupersetSessionPanel
        workspaceId={workspaceId}
        ready
        canEdit
        onFilesChanged={vi.fn()}
        onRunningChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Codex reported a configuration warning."),
    ).toBeInTheDocument();
    expect(screen.queryByText("configWarning")).not.toBeInTheDocument();
  });

  it("retries session loading after the Superset host startup race", async () => {
    let listRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.endsWith("/sessions/list")) {
          throw new Error(`Unexpected request: ${url}`);
        }
        listRequests += 1;
        return listRequests === 1
          ? new Response(
              JSON.stringify({ error: "Superset host service is unavailable" }),
              { status: 503 },
            )
          : new Response(JSON.stringify({ sessions: [] }), { status: 200 });
      }),
    );

    render(
      <SupersetSessionPanel
        workspaceId={workspaceId}
        ready
        canEdit
        onFilesChanged={vi.fn()}
        onRunningChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Superset host service is unavailable"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByText("Superset host service is unavailable"),
      ).not.toBeInTheDocument();
    });
    expect(listRequests).toBe(2);
  });
});
