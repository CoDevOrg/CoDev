import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

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

describe.each(preloadPaths)("native agent chat defaults in %s", (path) => {
  it("opens new Codex and Claude agent tabs in native chat", () => {
    expect(runPreload(path, {})).toMatchObject({
      experimentalNativeChat: true,
      openAgentTabsInChatByDefault: true,
      codevNativeChatDefaultV2Applied: true,
    });
  });

  it("does not override a choice made after the CoDev default was applied", () => {
    expect(
      runPreload(path, {
        codevNativeChatDefaultV2Applied: true,
        experimentalNativeChat: false,
        openAgentTabsInChatByDefault: false,
      }),
    ).toMatchObject({
      experimentalNativeChat: false,
      openAgentTabsInChatByDefault: false,
    });
  });
});
