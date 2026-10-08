import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LaunchProfile } from "../providers/registry";
import { withNativeCoordinationHooks } from "./agent-coordination-hooks";
import { buildGen2ClaudeCommand } from "./claude-command";
import { buildGen2CodexCommand } from "./codex-command";
import { buildGen2CursorCommand } from "./cursor-command";

// CI installs the image's pinned CLIs and sets this, so an update that changes
// a flag CoDev depends on fails before it can merge or reach an image.
const enabled = process.env.CODEV_AGENT_CLI_COMPAT === "1";
const ARGUMENT_ERROR =
  /unknown option|unexpected argument|unrecognized|invalid value for|error: option/i;

let home = "";
beforeAll(async () => {
  if (!enabled) return;
  home = await mkdtemp(join(tmpdir(), "codev-cli-compat-"));
  await mkdir(join(home, ".codex"), { recursive: true });
});
afterAll(() => (home ? rm(home, { recursive: true, force: true }) : undefined));

/**
 * Runs a CLI with no credentials; reaching auth means its arguments parsed.
 * Stops as soon as `until` appears, so a CLI waiting on the network is fine.
 */
function run(command: string[], until?: string) {
  return new Promise<string>((resolve) => {
    let output = "";
    const child = spawn(command[0]!, command.slice(1), {
      cwd: home,
      stdio: ["ignore", "pipe", "pipe"],
      // Deliberately minimal: no inherited credentials or provider settings.
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        CODEX_HOME: join(home, ".codex"),
        CLAUDE_CONFIG_DIR: join(home, ".claude"),
        NODE_ENV: "test",
      },
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (until && output.includes(until)) child.kill("SIGKILL");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("close", () => {
      clearTimeout(timer);
      resolve(output);
    });
  });
}

const help = (cli: string) => run([cli, "--help"]);
const prompt = "Reply with OK.";

describe.skipIf(!enabled)(
  "pinned agent CLIs accept CoDev's commands",
  { timeout: 90_000 },
  () => {
    it("Claude Code starts a native turn with the coordination hook settings", async () => {
      const native = buildGen2ClaudeCommand(prompt, [], "claude-opus-5-5");
      const hooked = withNativeCoordinationHooks(
        "claude",
        native,
        {} as LaunchProfile,
      ).command;
      for (const command of [native, hooked]) {
        const output = await run(command, '"subtype":"init"');
        expect(output).not.toMatch(ARGUMENT_ERROR);
        expect(output).toContain('"subtype":"init"');
        expect(output).toContain('"permissionMode":"bypassPermissions"');
      }
      const settingsFile = join(home, "settings.json");
      await writeFile(settingsFile, hooked[hooked.indexOf("--settings") + 1]!);
      const fromFile = [...hooked];
      fromFile[fromFile.indexOf("--settings") + 1] = settingsFile;
      expect(await run(fromFile, '"subtype":"init"')).toContain(
        '"subtype":"init"',
      );
    });

    it("Claude Code still offers the flags Superset agent sessions pass", async () => {
      const text = await help("claude");
      for (const flag of [
        "--print",
        "--include-partial-messages",
        "--resume",
        "--settings",
        "--dangerously-skip-permissions",
      ])
        expect(text).toContain(flag);
    });

    it("Codex starts a native exec turn", async () => {
      const output = await run(
        buildGen2CodexCommand(prompt, [], "gpt-5"),
        '"type":"thread.started"',
      );
      expect(output).not.toMatch(ARGUMENT_ERROR);
      expect(output).toContain('"type":"thread.started"');
    });

    it("Cursor accepts a native turn up to authentication", async () => {
      const output = await run(buildGen2CursorCommand(prompt, [], "auto"));
      expect(output).not.toMatch(ARGUMENT_ERROR);
      expect(output.trim()).not.toBe("");
    });
  },
);
