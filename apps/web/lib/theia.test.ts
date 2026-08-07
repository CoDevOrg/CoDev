import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  workspaceAgentsPath,
  workspaceIdFromSearch,
  workspaceStartupError,
} from "../../../packages/theia-extension/src/browser/codev-workspace-context";

import {
  scopeTheiaConnectionCookie,
  theiaSocketProxyPath,
  theiaWorkspaceUrl,
} from "./theia";

describe("Theia workspace transport", () => {
  it("builds a workspace-scoped static frontend URL", () => {
    expect(theiaWorkspaceUrl("e010bd2c-a3c1-438f-acef-166287a3b1cb")).toBe(
      "/theia/index.html?workspaceId=e010bd2c-a3c1-438f-acef-166287a3b1cb",
    );
  });

  it("rejects an unsafe workspace identifier", () => {
    expect(() => theiaWorkspaceUrl("../../socket.io")).toThrow(
      "Invalid workspace ID.",
    );
  });

  it("only appends a query string to the fixed Socket.IO endpoint", () => {
    expect(theiaSocketProxyPath("?EIO=4&transport=polling")).toBe(
      "/socket.io/?EIO=4&transport=polling",
    );
    expect(theiaSocketProxyPath("/unexpected")).toBe("/socket.io/");
  });

  it("scopes Theia's token cookie to one workspace", () => {
    expect(
      scopeTheiaConnectionCookie(
        "theia-connection-token=token; Path=/; HttpOnly; SameSite=Strict",
        "e010bd2c-a3c1-438f-acef-166287a3b1cb",
      ),
    ).toBe(
      "theia-connection-token=token; Path=/api/workspaces/e010bd2c-a3c1-438f-acef-166287a3b1cb/theia; HttpOnly; SameSite=Strict",
    );
  });

  it("opens the authenticated agent surface inside the workbench", () => {
    const workspaceId = "e010bd2c-a3c1-438f-acef-166287a3b1cb";
    expect(workspaceIdFromSearch(`?workspaceId=${workspaceId}`)).toBe(
      workspaceId,
    );
    expect(workspaceAgentsPath(workspaceId)).toBe(
      `/workspaces/${workspaceId}/agents`,
    );
    expect(workspaceIdFromSearch("?workspaceId=../../admin")).toBeUndefined();
  });

  it("surfaces the bootstrap error instead of connecting a dead socket", async () => {
    await expect(
      workspaceStartupError(
        new Response(
          JSON.stringify({ error: "The workspace host is asleep." }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    ).resolves.toBe("The workspace host is asleep.");
    await expect(workspaceStartupError(new Response(null))).resolves.toBe(
      undefined,
    );
  });

  it("does not expose guestd before the Theia backend is ready", () => {
    const bootstrap = readFileSync(
      resolve(process.cwd(), "../../infra/aws/scripts/bootstrap-host.sh"),
      "utf8",
    );

    expect(bootstrap).toContain(
      'cat >"${work_dir}/rootfs/usr/local/bin/codev-wait-for-theia"',
    );
    expect(bootstrap).toContain(
      "ExecStartPre=/usr/local/bin/codev-wait-for-theia",
    );
  });

  it("registers the workspace transport before Theia's backend preloader", () => {
    const extensionPackage = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "../../packages/theia-extension/package.json"),
        "utf8",
      ),
    ) as { theiaExtensions?: { frontendPreload?: string }[] };

    expect(extensionPackage.theiaExtensions?.[0]?.frontendPreload).toBe(
      "lib/browser/theia-extension-preload-module",
    );
  });
});
