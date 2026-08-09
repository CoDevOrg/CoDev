import { describe, expect, it } from "vitest";

import {
  buildCloneScript,
  extractPairingCode,
  orcaWorkspacePath,
  parseOrcaReady,
} from "./orca-pairing";

const WORKSPACE_ID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

function readyLine(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "orca_server_ready",
    schemaVersion: 1,
    runtimeId: "runtime-1",
    endpoint: "ws://0.0.0.0:6768",
    boundEndpoint: "ws://0.0.0.0:6768",
    advertisedEndpoint: "wss://3-21-99-52.nip.io",
    managedWslCliReconciliation: "settled",
    pairing: {
      available: true,
      url: "orca://pair?code=eyJ2IjoyfQ",
      endpoint: "wss://3-21-99-52.nip.io",
      deviceId: "device-1",
      webClientUrl: null,
      scope: "runtime",
    },
    ...overrides,
  });
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
  it("parses a runtime-scoped ready line", () => {
    expect(parseOrcaReady(readyLine())).toEqual({
      runtimeId: "runtime-1",
      endpoint: "wss://3-21-99-52.nip.io",
      pairingCode: "eyJ2IjoyfQ",
    });
  });

  it("surfaces the operator guidance when pairing is unavailable", () => {
    const line = readyLine({
      pairing: {
        available: false,
        reason: "e2ee_key_unavailable",
        guidance: "Restart the runtime.",
      },
    });
    expect(() => parseOrcaReady(line)).toThrow(/e2ee_key_unavailable/);
  });

  it("rejects mobile-scoped offers", () => {
    const line = readyLine({
      pairing: {
        available: true,
        url: "orca://pair?code=eyJ2IjoyfQ",
        endpoint: "wss://3-21-99-52.nip.io",
        deviceId: "device-1",
        webClientUrl: null,
        scope: "mobile",
      },
    });
    expect(() => parseOrcaReady(line)).toThrow(/non-runtime/);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseOrcaReady("Orca server ready")).toThrow(/not valid JSON/);
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

describe("buildCloneScript", () => {
  it("clones public repositories without credentials", () => {
    const script = buildCloneScript({
      workspaceId: WORKSPACE_ID,
      repository: "yousef20920/CoDev",
      defaultBranch: "main",
    });
    expect(script).toContain(
      "git clone --branch 'main' 'https://github.com/yousef20920/CoDev.git'",
    );
    expect(script).not.toContain("x-access-token");
  });

  it("uses the token for the clone but persists a tokenless remote", () => {
    const script = buildCloneScript({
      workspaceId: WORKSPACE_ID,
      repository: "yousef20920/CoDev",
      defaultBranch: "main",
      token: "ghu_secret123",
    });
    expect(script).toContain(
      "'https://x-access-token:ghu_secret123@github.com/yousef20920/CoDev.git'",
    );
    expect(script).toContain(
      "remote set-url origin 'https://github.com/yousef20920/CoDev.git'",
    );
  });

  it("rejects shell-unsafe repository names and branches", () => {
    expect(() =>
      buildCloneScript({
        workspaceId: WORKSPACE_ID,
        repository: "owner/repo; rm -rf /",
        defaultBranch: "main",
      }),
    ).toThrow(/Invalid repository/);
    expect(() =>
      buildCloneScript({
        workspaceId: WORKSPACE_ID,
        repository: "owner/repo",
        defaultBranch: "main'; echo pwned",
      }),
    ).toThrow(/Invalid branch/);
    expect(() =>
      buildCloneScript({
        workspaceId: WORKSPACE_ID,
        repository: "owner/repo",
        defaultBranch: "main",
        token: "bad token'",
      }),
    ).toThrow(/Invalid repository token/);
  });
});
