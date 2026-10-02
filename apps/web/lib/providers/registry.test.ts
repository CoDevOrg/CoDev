import { describe, expect, it } from "vitest";

import {
  PROVIDER_IDS,
  launchProfileFor,
  providerDefinition,
  providerRunsOn,
  runnableKinds,
  type ExecutorSurface,
} from "./registry";

describe("provider registry", () => {
  it("is the only place that decides where a credential can run", () => {
    // Codex is the exception that used to be hard-coded in four files: its
    // browser sign-in yields the same auth cache as `codex login`, so it is
    // the one browser credential a shared host may use.
    expect(runnableKinds("codex", "gen2").map((entry) => entry.kind)).toEqual([
      "codex_auth_cache",
      "api_key",
    ]);
    // One Claude login that runs everywhere, now that the browser sign-in
    // captures the same setup-token the CLI upload does.
    expect(runnableKinds("claude", "rooms").map((entry) => entry.kind)).toEqual(
      ["claude_setup_token"],
    );
    expect(runnableKinds("claude", "gen2").map((entry) => entry.kind)).toEqual([
      "claude_setup_token",
      "api_key",
    ]);
  });

  it("knows which providers an executor supports at all", () => {
    expect(providerRunsOn("codex", "gen2")).toBe(true);
    // Claude has its own command builder and stream reducer in lib/gen2.
    expect(providerRunsOn("claude", "gen2")).toBe(true);
  });

  it("gives every provider at least one place to run", () => {
    const surfaces: ExecutorSurface[] = ["rooms", "gen2"];
    for (const provider of PROVIDER_IDS) {
      expect(
        surfaces.some((surface) => providerRunsOn(provider, surface)),
      ).toBe(true);
    }
  });

  it("turns a credential into what a machine needs, per vendor", () => {
    expect(
      launchProfileFor("codex", {
        kind: "codex_auth_cache",
        authCacheJson: '{"auth_mode":"chatgpt"}',
      }),
    ).toEqual({
      files: [
        { path: ".codex/auth.json", contents: '{"auth_mode":"chatgpt"}' },
      ],
      // The guest expands this to the profile directory it created, which
      // is how the caller names CODEX_HOME without knowing the path.
      env: { CODEX_HOME: "{{profileDir}}/.codex" },
    });

    expect(
      launchProfileFor("claude", {
        kind: "claude_setup_token",
        token: "sk-ant-oat01-x",
      }),
    ).toEqual({ env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x" } });

    // Codex reads a file even for a bare key, so an API key does not become
    // an OPENAI_API_KEY environment variable the CLI would ignore.
    const codexKey = launchProfileFor("codex", {
      kind: "api_key",
      apiKey: "sk-test",
    });
    expect(codexKey.env).toEqual({ CODEX_HOME: "{{profileDir}}/.codex" });
    expect(JSON.parse(codexKey.files![0]!.contents)).toMatchObject({
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test",
    });

    expect(
      launchProfileFor("claude", { kind: "api_key", apiKey: "sk-ant-test" }),
    ).toEqual({ env: { ANTHROPIC_API_KEY: "sk-ant-test" } });
  });

  it("lists every kind a provider owns, in resolution order", () => {
    expect(providerDefinition("claude").kinds.map((k) => k.kind)).toEqual([
      "claude_setup_token",
      "api_key",
    ]);
  });
});

describe("Gen 2 agent list", () => {
  it("matches the providers the gen2 executor can run", async () => {
    const { GEN2_AGENT_PROVIDERS } = await import("@codev/contracts");
    const listed = GEN2_AGENT_PROVIDERS.map((entry) => entry.id).sort();
    const runnable = PROVIDER_IDS.filter((id) =>
      providerRunsOn(id, "gen2"),
    ).sort();
    expect(listed).toEqual(runnable);
  });
});
