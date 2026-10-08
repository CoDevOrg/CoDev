import { describe, expect, it } from "vitest";

import {
  NATIVE_COORDINATION_HOOK_COMMAND,
  withNativeCoordinationHooks,
} from "./agent-coordination-hooks";

const postToolUse = {
  hooks: {
    PostToolUse: [
      {
        matcher: "*",
        hooks: [{ type: "command", command: NATIVE_COORDINATION_HOOK_COMMAND }],
      },
    ],
  },
};

describe("native coordination hooks", () => {
  it("adds a private Codex hook file without changing the command", () => {
    const result = withNativeCoordinationHooks("codex", ["codex", "prompt"], {
      files: [{ path: ".codex/auth.json", contents: "{}" }],
      env: { CODEX_HOME: "{{profileDir}}/.codex" },
    });

    expect(result.command).toEqual(["codex", "prompt"]);
    expect(result.launchProfile.files).toEqual([
      { path: ".codex/auth.json", contents: "{}" },
      { path: ".codex/hooks.json", contents: JSON.stringify(postToolUse) },
    ]);
  });

  it("adds Cursor's user hook file under the profile home", () => {
    const result = withNativeCoordinationHooks(
      "cursor",
      ["cursor-agent", "p"],
      {
        env: { HOME: "{{profileDir}}", CURSOR_API_KEY: "key" },
      },
    );

    expect(result.launchProfile.files).toEqual([
      {
        path: ".cursor/hooks.json",
        contents: JSON.stringify({
          version: 1,
          hooks: {
            postToolUse: [{ command: NATIVE_COORDINATION_HOOK_COMMAND }],
          },
        }),
      },
    ]);
  });

  it("passes Claude's hook through --settings before the prompt", () => {
    const profile = { env: { CLAUDE_CODE_OAUTH_TOKEN: "token" } };
    const result = withNativeCoordinationHooks(
      "claude",
      ["claude", "-p", "--setting-sources", "", "--model", "m", "the prompt"],
      profile,
    );

    expect(result.command).toEqual([
      "claude",
      "-p",
      "--setting-sources",
      "",
      "--model",
      "m",
      "--settings",
      JSON.stringify(postToolUse),
      "the prompt",
    ]);
    expect(result.launchProfile).toBe(profile);
  });

  it("leaves a profile alone when the CLI would not read hooks from it", () => {
    const codex = { env: { OPENAI_API_KEY: "key" } };
    const cursor = { env: { CURSOR_API_KEY: "key" } };

    expect(
      withNativeCoordinationHooks("codex", ["codex", "p"], codex).launchProfile,
    ).toBe(codex);
    expect(
      withNativeCoordinationHooks("cursor", ["cursor-agent", "p"], cursor)
        .launchProfile,
    ).toBe(cursor);
  });

  it("keeps the token out of the command and always exits cleanly", () => {
    expect(NATIVE_COORDINATION_HOOK_COMMAND).toContain(
      "printf 'x-codev-hook-token: %s\\n' \"$CODEV_COORDINATION_TOKEN\" |",
    );
    expect(NATIVE_COORDINATION_HOOK_COMMAND).toContain("-H @-");
    expect(NATIVE_COORDINATION_HOOK_COMMAND.endsWith("exit 0")).toBe(true);
  });
});
