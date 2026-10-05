import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArmWorkspaceProvider } from "./arm-workspace-provider";

const workspaceId = "a61dc667-3fc5-451f-9f45-9308c8f50376";
const generation = 2;
const tunnelName = `codev-${createHash("sha256").update(workspaceId).digest("hex").slice(0, 20)}-g${generation}.trycodev.com`;
const tunnel = {
  id: "a".repeat(32),
  name: tunnelName,
  content: `${"a".repeat(32)}.cfargotunnel.com`,
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

describe("ARM workspace provider stop", () => {
  let calls: Array<{ url: string; method: string }>;
  let vmReads: number;
  let diskState: "Attached" | "Unattached";
  let deletedResources: Set<string>;

  beforeEach(() => {
    vi.stubEnv("AZURE_TENANT_ID", "tenant");
    vi.stubEnv("ARM_WORKSPACE_AZURE_CLIENT_ID", "client");
    vi.stubEnv("ARM_WORKSPACE_AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_SUBSCRIPTION_ID", "subscription");
    vi.stubEnv("ARM_WORKSPACE_RESOURCE_GROUP", "codev-arm-workspace-phase1");
    vi.stubEnv(
      "ARM_WORKSPACE_IMAGE_VERSION_ID",
      "/subscriptions/subscription/resourceGroups/codev-arm-workspace-phase1/providers/Microsoft.Compute/galleries/gallery/images/image/versions/1.0.10",
    );
    vi.stubEnv("ARM_WORKSPACE_SSH_PUBLIC_KEY", "ssh-ed25519 fixture");
    vi.stubEnv("ARM_WORKSPACE_SIGNING_PRIVATE_KEY", "unused");
    vi.stubEnv("ARM_WORKSPACE_SIGNING_PUBLIC_KEY", "BEGIN PUBLIC KEY");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "fixture-token");
    calls = [];
    vmReads = 0;
    diskState = "Attached";
    deletedResources = new Set();
  });

  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(routeFailure = false, diskMissing = false) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.redirect === "error")
          throw new TypeError("Unsupported Worker redirect mode");
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push({ url, method });
        if (url.includes("login.microsoftonline.com")) {
          return jsonResponse({
            access_token: "azure-token",
            expires_in: 3600,
          });
        }
        if (url.includes("api.cloudflare.com")) {
          if (routeFailure) return jsonResponse({ success: false }, 403);
          if (url.includes("/cfd_tunnel?name=")) {
            return jsonResponse({ success: true, result: [tunnel] });
          }
          if (url.includes("/dns_records?name=")) {
            return jsonResponse({
              success: true,
              result: [
                { id: "dns-id", name: tunnel.name, content: tunnel.content },
              ],
            });
          }
          return jsonResponse({ success: true, result: { id: "deleted" } });
        }
        if (url.includes("/providers/Microsoft.Compute/disks/")) {
          if (method === "GET" && diskMissing) return jsonResponse({}, 404);
          if (method === "GET")
            return jsonResponse({
              id: url.split("?")[0],
              tags: { Runtime: "arm-workspace", WorkspaceId: workspaceId },
              managedBy: diskState === "Attached" ? "vm-resource-id" : null,
              sku: { name: "StandardSSD_LRS" },
              properties: { diskSizeGB: 16, diskState },
            });
        }
        if (url.includes("/providers/Microsoft.Compute/virtualMachines/")) {
          if (method === "GET") {
            vmReads += 1;
            return jsonResponse({
              tags: {
                Runtime: "arm-workspace",
                WorkspaceId: workspaceId,
                Generation: String(generation),
              },
              properties: {
                instanceView: {
                  statuses: [
                    {
                      code: `PowerState/${vmReads === 1 ? "running" : "deallocated"}`,
                    },
                  ],
                },
              },
            });
          }
          if (method === "DELETE") {
            const resource = url.split("?")[0]!;
            if (deletedResources.has(resource)) return jsonResponse({}, 404);
            deletedResources.add(resource);
          }
          return jsonResponse({});
        }
        if (
          url.includes("/providers/Microsoft.Network/") &&
          method === "DELETE"
        ) {
          const resource = url.split("?")[0]!;
          if (deletedResources.has(resource)) return jsonResponse({}, 404);
          deletedResources.add(resource);
          return jsonResponse({});
        }
        return jsonResponse({});
      }) as typeof fetch,
    );
  }

  it("reads the created disk after Azure returns an asynchronous status response", async () => {
    stubFetch();
    const fallback = fetch;
    let created = false;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://management.azure.com/operation") {
          return jsonResponse({ status: "Succeeded" });
        }
        if (url.includes("/providers/Microsoft.Compute/disks/")) {
          if (init?.method === "PUT") {
            created = true;
            return new Response(JSON.stringify({ status: "Creating" }), {
              status: 202,
              headers: {
                "azure-asyncoperation":
                  "https://management.azure.com/operation",
                "retry-after": "1",
              },
            });
          }
          if (!created) return jsonResponse({}, 404);
        }
        return fallback(input, init);
      },
    );
    const progress = vi.fn(
      async (_status: string, resources: { diskId?: string }) => {
        expect(resources.diskId).toContain(
          "/providers/Microsoft.Compute/disks/",
        );
        throw new Error("stop after disk provisioning");
      },
    );
    await expect(
      new ArmWorkspaceProvider().start(
        { workspaceId, generation, diskId: null, diskUuid: null },
        progress,
      ),
    ).rejects.toThrow("stop after disk provisioning");
    expect(progress).toHaveBeenCalledOnce();
  });

  it("reads running state from the Azure REST properties envelope", async () => {
    stubFetch();
    await expect(
      new ArmWorkspaceProvider().running(
        workspaceId,
        generation,
        "/subscriptions/subscription/resourceGroups/codev-arm-workspace-phase1/providers/Microsoft.Compute/virtualMachines/fixture",
      ),
    ).resolves.toBe(true);
  });

  it("deallocates the owned VM before deleting it and its network", async () => {
    stubFetch();

    await new ArmWorkspaceProvider().stop({
      workspaceId,
      generation,
      diskId: null,
      diskUuid: null,
    });

    const deallocate = calls.findIndex(
      (call) =>
        call.method === "POST" &&
        call.url.endsWith("/deallocate?api-version=2024-07-01"),
    );
    const vmDelete = calls.findIndex(
      (call) =>
        call.method === "DELETE" &&
        call.url.includes("/providers/Microsoft.Compute/virtualMachines/"),
    );
    const nicDelete = calls.findIndex(
      (call) =>
        call.method === "DELETE" &&
        call.url.includes("/providers/Microsoft.Network/networkInterfaces/"),
    );
    expect(deallocate).toBeGreaterThan(-1);
    expect(vmDelete).toBeGreaterThan(deallocate);
    expect(nicDelete).toBeGreaterThan(vmDelete);
    expect(vmReads).toBe(2);
  });

  it("still removes billable compute when tunnel cleanup fails", async () => {
    stubFetch(true);

    await expect(
      new ArmWorkspaceProvider().stop({
        workspaceId,
        generation,
        diskId: null,
        diskUuid: null,
      }),
    ).rejects.toMatchObject({ code: "CLOUDFLARE_TUNNEL_FAILED" });

    expect(
      calls.some((call) =>
        call.url.endsWith("/deallocate?api-version=2024-07-01"),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.url.includes("/providers/Microsoft.Compute/virtualMachines/"),
      ),
    ).toBe(true);
    expect(
      calls.filter(
        (call) =>
          call.method === "DELETE" &&
          call.url.includes("/providers/Microsoft.Network/"),
      ),
    ).toHaveLength(4);
  });

  it("can retry stop after tunnel cleanup failed following VM and network removal", async () => {
    const provider = new ArmWorkspaceProvider();
    stubFetch(true);

    await expect(
      provider.stop({ workspaceId, generation, diskId: null, diskUuid: null }),
    ).rejects.toMatchObject({ code: "CLOUDFLARE_TUNNEL_FAILED" });

    stubFetch();
    await expect(
      provider.stop({ workspaceId, generation, diskId: null, diskUuid: null }),
    ).resolves.toBeUndefined();

    expect(deletedResources).toHaveLength(5);
    expect(
      calls.filter(
        (call) =>
          call.method === "DELETE" &&
          (call.url.includes("/providers/Microsoft.Compute/virtualMachines/") ||
            call.url.includes("/providers/Microsoft.Network/")),
      ),
    ).toHaveLength(10);
  });

  it("does not replace a missing saved disk with a fresh disk", async () => {
    stubFetch(false, true);

    await expect(
      new ArmWorkspaceProvider().start(
        {
          workspaceId,
          generation,
          diskId: `/subscriptions/subscription/resourceGroups/codev-arm-workspace-phase1/providers/Microsoft.Compute/disks/saved-data`,
          diskUuid: "saved-uuid",
        },
        vi.fn(async () => undefined),
      ),
    ).rejects.toMatchObject({ code: "DISK_MISSING" });

    expect(
      calls.some(
        (call) =>
          call.method === "PUT" &&
          call.url.includes("/providers/Microsoft.Compute/disks/"),
      ),
    ).toBe(false);
    expect(
      calls.some((call) =>
        call.url.includes("/providers/Microsoft.Resources/deployments/"),
      ),
    ).toBe(false);
  });

  it("keeps an attached disk during partial delete and removes it on retry after detach", async () => {
    const provider = new ArmWorkspaceProvider();
    const diskId = `/subscriptions/subscription/resourceGroups/codev-arm-workspace-phase1/providers/Microsoft.Compute/disks/saved-data`;
    stubFetch();

    await expect(
      provider.deleteDisk(diskId, workspaceId),
    ).rejects.toMatchObject({
      code: "DISK_ATTACH_CONFLICT",
    });
    expect(
      calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.url.includes("/providers/Microsoft.Compute/disks/"),
      ),
    ).toBe(false);

    diskState = "Unattached";
    await provider.deleteDisk(diskId, workspaceId);
    expect(
      calls.filter(
        (call) =>
          call.method === "DELETE" &&
          call.url.includes("/providers/Microsoft.Compute/disks/"),
      ),
    ).toHaveLength(1);

    stubFetch(false, true);
    await expect(
      provider.deleteDisk(diskId, workspaceId),
    ).resolves.toBeUndefined();
  });
});
