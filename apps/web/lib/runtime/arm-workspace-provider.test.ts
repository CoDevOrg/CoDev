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

  beforeEach(() => {
    vi.stubEnv("AZURE_TENANT_ID", "tenant");
    vi.stubEnv("AZURE_CLIENT_ID", "client");
    vi.stubEnv("AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_SUBSCRIPTION_ID", "subscription");
    vi.stubEnv("AZURE_RESOURCE_GROUP", "codev-arm-workspace-phase1");
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
  });

  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(routeFailure = false) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        if (url.includes("/providers/Microsoft.Compute/virtualMachines/")) {
          if (method === "GET") {
            vmReads += 1;
            return jsonResponse({
              tags: {
                Runtime: "arm-workspace",
                WorkspaceId: workspaceId,
                Generation: String(generation),
              },
              instanceView: {
                statuses: [
                  {
                    code: `PowerState/${vmReads === 1 ? "running" : "deallocated"}`,
                  },
                ],
              },
            });
          }
          return jsonResponse({});
        }
        return jsonResponse({});
      }) as typeof fetch,
    );
  }

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
  });
});
