import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  exec: vi.fn(),
  config: vi.fn(),
  target: vi.fn(),
}));
vi.mock("./preview-access", () => ({ gen2PreviewAccess: mocks.access }));
vi.mock("../runtime/orchestrator-files", () => ({
  executeInSandbox: mocks.exec,
}));
vi.mock("../runtime/arm-workspace-config", () => ({
  readArmWorkspaceConfig: mocks.config,
}));
vi.mock("../runtime/workspace-runtime-target", () => ({
  runtimeTargetFromRow: mocks.target,
}));

import { Gen2AccessError } from "./errors";
import { OrchestratorError } from "../runtime/orchestrator-request";
import { listGen2WorkspacePorts } from "./workspace-ports";

const ready = {
  provider: "azure_arm",
  status: "ready",
  generation: 2,
  host: "codev-x-g2.trycodev.com",
  tunnelId: "tunnel",
};
const target = { workspaceId: "w", generation: 2, host: ready.host };
const proxyRow =
  "   0: 0100007F:148D 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1";
const devRow =
  "   1: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  2000        0 2 1";

describe("listing previewable ports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CODEV_PREVIEW_ZONE", "codev-preview.dev");
    vi.stubEnv("CODEV_PREVIEW_ZONE_ID", "0123456789abcdef0123456789abcdef");
    mocks.access.mockResolvedValue(ready);
    mocks.config.mockReturnValue({ bootEnabled: true });
    mocks.target.mockResolvedValue(target);
    mocks.exec.mockResolvedValue({
      output: `${proxyRow}\r\n${devRow}\r\n`,
      exitCode: 0,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads sockets without recording activity, through the checked route", async () => {
    expect(await listGen2WorkspacePorts("w", "u")).toEqual({
      available: true,
      reason: null,
      ports: [{ port: 3000, address: "any" }],
    });
    expect(mocks.access).toHaveBeenCalledWith("w", "u");
    expect(mocks.exec).toHaveBeenCalledWith(
      "w",
      {
        command: ["cat", "/proc/net/tcp", "/proc/net/tcp6"],
        timeoutSeconds: 8,
      },
      { recordActivity: false, timeoutMs: 10_000, target },
    );
  });

  it("answers without touching the guest when previews cannot work", async () => {
    vi.stubEnv("CODEV_PREVIEW_ZONE", "");
    expect(await listGen2WorkspacePorts("w", "u")).toMatchObject({
      available: false,
      reason: "not_configured",
    });
    vi.stubEnv("CODEV_PREVIEW_ZONE", "codev-preview.dev");
    mocks.access.mockResolvedValueOnce({ ...ready, status: "stopped" });
    expect((await listGen2WorkspacePorts("w", "u")).reason).toBe("not_ready");
    mocks.config.mockReturnValueOnce({ bootEnabled: false });
    expect((await listGen2WorkspacePorts("w", "u")).reason).toBe(
      "image_update",
    );
    expect(mocks.exec).not.toHaveBeenCalled();
  });

  it("asks for an image update when the proxy socket is missing or squatted", async () => {
    mocks.exec.mockResolvedValueOnce({ output: devRow, exitCode: 0 });
    expect(await listGen2WorkspacePorts("w", "u")).toEqual({
      available: false,
      reason: "image_update",
      ports: [],
    });
  });

  it("reports a guest busy with an agent turn instead of waiting", async () => {
    mocks.exec.mockRejectedValueOnce(new Error("Workspace request timed out."));
    expect((await listGen2WorkspacePorts("w", "u")).reason).toBe("busy");
    mocks.exec.mockRejectedValueOnce(new OrchestratorError("timed out", 408));
    expect((await listGen2WorkspacePorts("w", "u")).reason).toBe("busy");
    mocks.exec.mockRejectedValueOnce(new OrchestratorError("stopped", 409));
    expect((await listGen2WorkspacePorts("w", "u")).reason).toBe("not_ready");
    mocks.exec.mockRejectedValueOnce(new OrchestratorError("broken", 500));
    await expect(listGen2WorkspacePorts("w", "u")).rejects.toThrow("broken");
  });

  it("rejects viewers before reading anything", async () => {
    mocks.access.mockRejectedValueOnce(
      new Gen2AccessError("Only editors can open previews.", 403),
    );
    await expect(listGen2WorkspacePorts("w", "u")).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.exec).not.toHaveBeenCalled();
  });
});
