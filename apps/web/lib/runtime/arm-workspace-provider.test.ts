import { gunzipSync } from "node:zlib";
import { createHash, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkflowStep } from "cloudflare:workers";
import { ArmWorkflowIO } from "./arm-workflow-io";
import { ArmWorkspaceProvider } from "./arm-workspace-provider";

const workspaceId = "a61dc667-3fc5-451f-9f45-9308c8f50376";
const generation = 2;
const tunnelName = `codev-${createHash("sha256").update(workspaceId).digest("hex").slice(0, 20)}-g${generation}.trycodev.com`;
const tunnel = {
  id: "a".repeat(32),
  name: tunnelName.replace(".trycodev.com", ""),
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

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
                { id: "dns-id", name: tunnelName, content: tunnel.content },
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

  it.each([
    [1, 5_000],
    [22, 22_000],
  ])(
    "reads the created disk while honoring Azure Retry-After %s",
    async (retryAfter, expectedDelay) => {
      const delays: number[] = [];
      vi.stubGlobal("setTimeout", ((callback: () => void, delay = 0) => {
        delays.push(delay);
        queueMicrotask(callback);
        return 0;
      }) as typeof setTimeout);
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
                  "retry-after": String(retryAfter),
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
      expect(delays).toEqual([expectedDelay]);
    },
  );

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

  it("revokes DNS before deallocation and deletes the tunnel after the VM is offline", async () => {
    stubFetch();
    await new ArmWorkspaceProvider().stop({
      workspaceId,
      generation,
      diskId: null,
      diskUuid: null,
    });
    const deallocate = calls.findIndex(
      (call) => call.url.includes("/deallocate") && call.method === "POST",
    );
    const tunnelDelete = calls.findIndex(
      (call) =>
        call.url.endsWith(`/cfd_tunnel/${tunnel.id}`) &&
        call.method === "DELETE",
    );
    const routeLookup = calls.findIndex((call) =>
      call.url.includes("/dns_records?name="),
    );
    expect(routeLookup).toBeGreaterThanOrEqual(0);
    expect(routeLookup).toBeLessThan(deallocate);
    expect(tunnelDelete).toBeGreaterThan(deallocate);
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

  it("resumes connection checks without redeploying or preparing a saved disk", async () => {
    const keys = generateKeyPairSync("ed25519");
    vi.stubEnv(
      "ARM_WORKSPACE_SIGNING_PRIVATE_KEY",
      keys.privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("base64"),
    );
    vi.stubEnv(
      "ARM_WORKSPACE_SIGNING_PUBLIC_KEY",
      keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    );
    const progress = vi.fn(async () => undefined);
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(String(input));
        expect(String(input)).toBe(`https://${tunnelName}/v1/health`);
        expect(new Headers(init?.headers).get("authorization")).toMatch(
          /^Bearer /,
        );
        return jsonResponse({
          ready: true,
          workspaceId,
          generation,
          diskUuid: "saved-disk-uuid",
        });
      },
    );
    const resources = {
      vmId: "saved-vm",
      diskId: "saved-disk",
      diskUuid: "saved-disk-uuid",
      tunnelId: tunnel.id,
      routeHost: tunnelName,
    };
    await expect(
      new ArmWorkspaceProvider().start(
        {
          workspaceId,
          generation,
          diskId: resources.diskId,
          diskUuid: resources.diskUuid,
          resume: {
            status: "checking_readiness",
            vmId: resources.vmId,
            tunnelId: resources.tunnelId,
            routeHost: resources.routeHost,
          },
        },
        progress,
      ),
    ).resolves.toEqual(resources);
    expect(requests).toHaveLength(1);
    expect(progress).not.toHaveBeenCalled();
  });

  function stubBakedStart(gateDiskOnTunnel = true) {
    vi.stubEnv("ARM_WORKSPACE_BOOT_ENABLED", "true");
    const keys = generateKeyPairSync("ed25519");
    vi.stubEnv(
      "ARM_WORKSPACE_SIGNING_PRIVATE_KEY",
      keys.privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("base64"),
    );
    const requests: string[] = [];
    const state: {
      identity?: { diskUuid: string; diskMode: string; tunnelToken: string };
      requests: string[];
    } = { requests };
    let vmReads = 0;
    let releaseDisk!: () => void;
    const tunnelConfigured = new Promise<void>((resolve) => {
      releaseDisk = resolve;
    });
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("login.microsoftonline.com"))
          return jsonResponse({
            access_token: "azure-token",
            expires_in: 3600,
          });
        if (url.includes("api.cloudflare.com")) {
          if (url.endsWith("/dns_records") && init?.method === "POST")
            releaseDisk();
          const result = url.includes("?name=")
            ? []
            : url.endsWith("/token")
              ? "connector-token"
              : url.endsWith("/cfd_tunnel")
                ? {
                    id: tunnel.id,
                    name: tunnel.name,
                    token: "create-token",
                    credentials_file: { TunnelSecret: "tunnel-secret" },
                  }
                : { id: tunnel.id };
          return jsonResponse({ success: true, result });
        }
        if (url.includes("/disks/")) {
          if (init?.method === "PUT" && gateDiskOnTunnel)
            await tunnelConfigured;
          return init?.method === "PUT"
            ? jsonResponse({
                id: "disk-id",
                tags: { Runtime: "arm-workspace", WorkspaceId: workspaceId },
              })
            : jsonResponse({}, 404);
        }
        if (url.includes("/deployments/")) {
          const deployment = JSON.parse(String(init?.body));
          expect(
            deployment.properties.template.parameters.bootScript.type,
          ).toBe("secureString");
          const resources: Array<{
            type: string;
            properties: {
              ipConfigurations?: Array<{
                properties: { subnet: { id: string } };
              }>;
            };
          }> = deployment.properties.template.resources;
          // Starts reuse the resource group's network instead of creating one.
          expect(resources.map((resource) => resource.type)).toEqual([
            "Microsoft.Network/publicIPAddresses",
            "Microsoft.Network/networkInterfaces",
            "Microsoft.Compute/virtualMachines",
            "Microsoft.Compute/virtualMachines/extensions",
          ]);
          expect(deployment.properties.template.variables.subnetId).toBe(
            "[resourceId('Microsoft.Network/virtualNetworks/subnets', 'codev-arm-workspace-vnet', 'workspace')]",
          );
          expect(
            resources[1]?.properties.ipConfigurations?.[0]?.properties.subnet
              .id,
          ).toBe("[variables('subnetId')]");
          const extension = deployment.properties.template.resources.find(
            (r: { type: string }) => r.type.endsWith("/extensions"),
          );
          expect(extension.properties.protectedSettings.script).toBe(
            "[parameters('bootScript')]",
          );
          const script = gunzipSync(
            Buffer.from(
              deployment.properties.parameters.bootScript.value,
              "base64",
            ),
          ).toString();
          expect(script).not.toMatch(/curl|apt|dpkg|mkfs/);
          state.identity = JSON.parse(
            Buffer.from(script.split("\n")[4] ?? "", "base64").toString(),
          );
          return jsonResponse({});
        }
        if (url.includes("/virtualMachines/"))
          return ++vmReads === 1
            ? jsonResponse({}, 404)
            : jsonResponse({
                id: "vm-id",
                tags: {
                  Runtime: "arm-workspace",
                  WorkspaceId: workspaceId,
                  Generation: String(generation),
                },
              });
        if (url.endsWith("/v1/health"))
          return jsonResponse({
            ready: true,
            workspaceId,
            generation,
            diskUuid: state.identity?.diskUuid,
          });
        throw new Error(`Unexpected ${url}`);
      },
    );
    return state;
  }

  const freshStart = {
    workspaceId,
    generation,
    diskId: null,
    diskUuid: null,
    resume: {
      status: "queued" as const,
      vmId: "old-generation-vm",
      tunnelId: "old-tunnel",
      routeHost: "old.trycodev.com",
    },
  };

  it("delivers boot identity in protected deployment settings without sequential guest commands", async () => {
    const { identity, requests } = await (async () => {
      const state = stubBakedStart();
      const resources = await new ArmWorkspaceProvider().start(
        freshStart,
        vi.fn(async () => undefined),
      );
      expect(resources.diskUuid).toBe(state.identity?.diskUuid);
      return state;
    })();
    expect(identity?.diskMode).toBe("new");
    expect(identity?.tunnelToken).toBe("connector-token");
    expect(requests.some((url) => url.includes("/runCommands/"))).toBe(false);
    expect(requests.some((url) => url.includes("/extensions/"))).toBe(false);
  });

  it("never journals tunnel credentials in workflow outputs or handoffs", async () => {
    // Handoffs can split the parallel tunnel branch, so the disk is not gated.
    const state = stubBakedStart(false);
    const outputs: unknown[] = [];
    const step = {
      do: vi.fn(async (_name, _options, action) => {
        const value = await action();
        outputs.push(value);
        return value;
      }),
      sleep: vi.fn(async () => undefined),
    } as unknown as WorkflowStep;
    let checkpoints: Record<string, unknown> = {};
    let complete = false;
    for (let runs = 0; !complete; runs++) {
      expect(runs).toBeLessThan(10);
      await ArmWorkflowIO.run(step, "arm-start-2", checkpoints, async () => {
        try {
          await new ArmWorkspaceProvider().start(
            freshStart,
            vi.fn(async () => undefined),
          );
          complete = true;
        } catch (error) {
          expect(error).toMatchObject({ code: "WORKFLOW_CONTINUE" });
          checkpoints = JSON.parse(JSON.stringify(ArmWorkflowIO.saved()));
        }
      });
    }
    expect(state.identity?.tunnelToken).toBe("connector-token");
    const journal = JSON.stringify({ outputs, checkpoints });
    for (const secret of ["connector-token", "create-token", "tunnel-secret"])
      expect(journal).not.toContain(secret);
  });

  it("polls a VM deployment near its usual finish and wakes after one handoff", async () => {
    const state = stubBakedStart(false);
    const fallback = fetch;
    const savedDisk = `/subscriptions/subscription/resourceGroups/codev-arm-workspace-phase1/providers/Microsoft.Compute/disks/saved-data`;
    let now = 1_000_000;
    let finishAt = Number.POSITIVE_INFINITY;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/deployments/") && init?.method === "PUT") {
          await fallback(input, init);
          finishAt = now + 50_000;
          return new Response("{}", {
            status: 201,
            headers: {
              "azure-asyncoperation": "https://management.azure.com/deploy-op",
            },
          });
        }
        if (url.includes("/deployments/")) return jsonResponse({});
        if (url === "https://management.azure.com/deploy-op")
          return jsonResponse({
            status: now >= finishAt ? "Succeeded" : "Running",
          });
        if (url.includes("/disks/"))
          return jsonResponse({
            id: savedDisk,
            tags: { Runtime: "arm-workspace", WorkspaceId: workspaceId },
            sku: { name: "StandardSSD_LRS" },
            properties: { diskSizeGB: 16, diskState: "Unattached" },
          });
        return fallback(input, init);
      },
    );
    const sleeps: number[] = [];
    const step = {
      do: async (_name: string, _options: unknown, action: () => unknown) =>
        action(),
      sleep: async (_name: string, milliseconds: number) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    } as unknown as WorkflowStep;
    let checkpoints: Record<string, unknown> = {};
    let runs = 0;
    for (let complete = false; !complete; runs++) {
      expect(runs).toBeLessThan(5);
      await ArmWorkflowIO.run(step, "arm-start-2", checkpoints, async () => {
        try {
          await new ArmWorkspaceProvider().start(
            { ...freshStart, diskId: savedDisk, diskUuid: "saved-uuid" },
            vi.fn(async () => undefined),
          );
          complete = true;
        } catch (error) {
          expect(error).toMatchObject({ code: "WORKFLOW_CONTINUE" });
          checkpoints = JSON.parse(JSON.stringify(ArmWorkflowIO.saved()));
        }
      });
    }
    expect(state.identity?.diskMode).toBe("existing");
    expect(sleeps).toEqual([
      30_000, 5_000, 5_000, 2_000, 2_000, 2_000, 2_000, 2_000,
    ]);
    // Lifecycle progress writes add a few requests in production; still one handoff.
    expect(runs).toBe(2);
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
