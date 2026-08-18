import { describe, expect, it } from "vitest";

import {
  extractPairingCode,
  orcaPersonalPath,
  orcaWorkspacePath,
  parseOrcaReady,
} from "./orca-pairing";

const WORKSPACE_ID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

function ready(overrides: Record<string, unknown> = {}) {
  return {
    type: "orca_server_ready",
    schemaVersion: 1,
    runtimeId: "runtime-1",
    boundEndpoint: "ws://0.0.0.0:6768",
    advertisedEndpoint: `wss://3-21-99-52.nip.io/w/${WORKSPACE_ID}`,
    pairing: {
      available: true,
      url: "orca://pair?code=eyJ2IjoyfQ",
      endpoint: `wss://3-21-99-52.nip.io/w/${WORKSPACE_ID}`,
      deviceId: "device-1",
      webClientUrl: null,
      scope: "runtime",
    },
    ...overrides,
  };
}

describe("extractPairingCode", () => {
  it("extracts the code from an orca pairing deep link", () => {
    expect(extractPairingCode("orca://pair?code=abc_DEF-123")).toBe(
      "abc_DEF-123",
    );
  });

  it("rejects non-pairing URLs", () => {
    expect(extractPairingCode("https://pair?code=x")).toBeNull();
    expect(extractPairingCode("orca://other?code=x")).toBeNull();
    expect(extractPairingCode("not a url")).toBeNull();
  });
});

describe("parseOrcaReady", () => {
  it("parses a runtime-scoped ready object for its own workspace", () => {
    expect(parseOrcaReady(ready(), WORKSPACE_ID)).toEqual({
      runtimeId: "runtime-1",
      endpoint: `wss://3-21-99-52.nip.io/w/${WORKSPACE_ID}`,
      pairingCode: "eyJ2IjoyfQ",
    });
  });

  it("surfaces the operator guidance when pairing is unavailable", () => {
    const value = ready({
      pairing: {
        available: false,
        reason: "e2ee_key_unavailable",
        guidance: "Restart the runtime.",
      },
    });
    expect(() => parseOrcaReady(value, WORKSPACE_ID)).toThrow(
      /e2ee_key_unavailable/,
    );
  });

  it("rejects mobile-scoped offers", () => {
    const value = ready({
      pairing: {
        available: true,
        url: "orca://pair?code=eyJ2IjoyfQ",
        endpoint: `wss://3-21-99-52.nip.io/w/${WORKSPACE_ID}`,
        deviceId: "device-1",
        webClientUrl: null,
        scope: "mobile",
      },
    });
    expect(() => parseOrcaReady(value, WORKSPACE_ID)).toThrow(/non-runtime/);
  });

  it("rejects an endpoint outside this workspace's own path-scoped route", () => {
    const otherWorkspaceId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(() => parseOrcaReady(ready(), otherWorkspaceId)).toThrow(
      /outside this workspace/,
    );
  });

  it("rejects malformed shapes", () => {
    expect(() => parseOrcaReady({ type: "not_ready" }, WORKSPACE_ID)).toThrow();
  });
});

describe("orcaWorkspacePath", () => {
  it("builds the host path for a workspace id", () => {
    expect(orcaWorkspacePath(WORKSPACE_ID)).toBe(
      `/srv/codev/workspaces/${WORKSPACE_ID}`,
    );
  });

  it("rejects non-uuid workspace ids", () => {
    expect(() => orcaWorkspacePath("../etc")).toThrow(/Invalid workspace id/);
  });
});

describe("orcaPersonalPath", () => {
  it("shares the workspace root, since the orchestrator only validates one", () => {
    expect(orcaPersonalPath(WORKSPACE_ID)).toBe(
      `/srv/codev/workspaces/${WORKSPACE_ID}`,
    );
  });

  it("rejects non-uuid user ids", () => {
    expect(() => orcaPersonalPath("../etc")).toThrow(/Invalid workspace id/);
  });
});
