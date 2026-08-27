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
  let stored = JSON.stringify(initial);
  const window = {
    localStorage: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    },
  };
  runInNewContext(readFileSync(path, "utf8"), { window });
  return JSON.parse(stored) as Record<string, unknown>;
}

describe.each(preloadPaths)("CoDev Orca preload seeds in %s", (path) => {
  it("applies the one-shot mobile-button default", () => {
    expect(runPreload(path, {})).toMatchObject({
      showMobileButton: false,
      codevMobileDefaultApplied: true,
    });
  });

  it("does not re-apply the mobile default once the marker is set", () => {
    expect(
      runPreload(path, {
        codevMobileDefaultApplied: true,
        showMobileButton: true,
      }),
    ).toMatchObject({ showMobileButton: true });
  });

  it("no longer seeds native chat here — that moved to getStoredSettings() in the vendored patch, which forces it on for every CoDev-embedded client and cannot be defeated by a stale localStorage blob", () => {
    const seeded = runPreload(path, {});
    expect(seeded).not.toHaveProperty("experimentalNativeChat");
    expect(seeded).not.toHaveProperty("openAgentTabsInChatByDefault");
  });
});
