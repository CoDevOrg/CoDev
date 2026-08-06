import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

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
});
