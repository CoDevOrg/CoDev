import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

// Both copies of the preload run byte-identical (brand-web.mjs copies the
// infra one into the bundle), so assert against each.
const preloadPaths = [
  "public/orca/codev-preload.js",
  "../../infra/aws/orca-build/codev-preload.js",
];

function runPreload(path: string, initial: Record<string, unknown>) {
  const store: Record<string, string> = {
    "orca.web.settings.v1": JSON.stringify(initial),
  };
  const window = {
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    },
  };
  runInNewContext(readFileSync(path, "utf8"), { window });
  return {
    settings: JSON.parse(store["orca.web.settings.v1"] ?? "{}") as Record<
      string,
      unknown
    >,
    ui: JSON.parse(store["orca.web.ui.v1"] ?? "{}") as Record<string, unknown>,
  };
}

describe.each(preloadPaths)("CoDev Orca preload seeds in %s", (path) => {
  it("applies the one-shot mobile-button default", () => {
    expect(runPreload(path, {}).settings).toMatchObject({
      showMobileButton: false,
      codevMobileDefaultApplied: true,
    });
  });

  it("lands the member on the live-agents panel, once", () => {
    expect(runPreload(path, {}).ui).toMatchObject({
      rightSidebarTab: "codev-agents",
      rightSidebarOpen: true,
      codevLiveAgentsDefaultApplied: true,
    });
  });

  it("does not re-apply the mobile default once the marker is set", () => {
    expect(
      runPreload(path, {
        codevMobileDefaultApplied: true,
        showMobileButton: true,
      }).settings,
    ).toMatchObject({ showMobileButton: true });
  });

  it("no longer seeds native chat here — that moved to getStoredSettings() in the vendored patch, which forces it on for every CoDev-embedded client and cannot be defeated by a stale localStorage blob", () => {
    const seeded = runPreload(path, {}).settings;
    expect(seeded).not.toHaveProperty("experimentalNativeChat");
    expect(seeded).not.toHaveProperty("openAgentTabsInChatByDefault");
  });
});
