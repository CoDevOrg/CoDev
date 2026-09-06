import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./database", () => ({ getDatabase: vi.fn() }));
vi.mock("./credentials", () => ({ saveProviderCredential: vi.fn() }));
vi.mock("./settings-access", () => ({
  requireOrganizationSettingsWrite: vi.fn(),
}));

import { unavailableClaudeRunner } from "./claude-connection-session";
import {
  isHostedClaudeConnectEnabled,
  resolveClaudeRunner,
  subprocessClaudeRunner,
} from "./claude-connection-runner";

/**
 * Stand-in for `claude setup-token`: prints a URL, then reads one line from
 * stdin — `good` prints a token and exits 0, anything else exits 1.
 */
const FAKE = `
process.stdout.write("Open this URL to authorize:\\n");
process.stdout.write("https://claude.ai/oauth/authorize?code=true&client_id=abc\\n");
process.stdout.write("Paste code here: ");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  if (!buf.includes("\\n")) return;
  const code = buf.trim();
  if (code === "good") {
    process.stdout.write("\\nLogin successful. Token: sk-ant-oat01-" + "a".repeat(32) + "\\n");
    process.exit(0);
  }
  process.stderr.write("\\nInvalid authorization code\\n");
  process.exit(1);
});
`;

const EXIT_IMMEDIATELY = `process.stderr.write("boom\\n"); process.exit(2);`;

let fakePath: string;
let exitPath: string;

async function pollUntilTerminal(runnerId: string, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const result = await subprocessClaudeRunner.poll({ runnerId });
    if (result.status !== "pending") return result;
    await new Promise((r) => setTimeout(r, 50));
  }
  return { status: "pending" as const };
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "claude-runner-test-"));
  fakePath = join(dir, "fake-setup-token.mjs");
  exitPath = join(dir, "exit.mjs");
  await writeFile(fakePath, FAKE);
  await writeFile(exitPath, EXIT_IMMEDIATELY);
  vi.stubEnv("CLAUDE_CONNECTION_RUNNER_COMMAND", process.execPath);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("resolveClaudeRunner", () => {
  it("is unavailable unless explicitly opted in", () => {
    vi.stubEnv("CLAUDE_CONNECTION_RUNNER", "");
    expect(resolveClaudeRunner()).toBe(unavailableClaudeRunner);
    expect(isHostedClaudeConnectEnabled()).toBe(false);
    vi.stubEnv("CLAUDE_CONNECTION_RUNNER", "subprocess");
    expect(resolveClaudeRunner()).toBe(subprocessClaudeRunner);
    expect(isHostedClaudeConnectEnabled()).toBe(true);
  });
});

describe("subprocessClaudeRunner", () => {
  it("captures the authorize URL, then the token on a good code", async () => {
    vi.stubEnv("CLAUDE_CONNECTION_RUNNER_ARGS", JSON.stringify([fakePath]));
    const { runnerId, authorizeUrl } = await subprocessClaudeRunner.start({
      sessionId: "s-good",
    });
    expect(authorizeUrl).toContain("oauth/authorize");

    await subprocessClaudeRunner.submitCode({ runnerId, code: "good" });
    const result = await pollUntilTerminal(runnerId);
    expect(result.status).toBe("ready");
    expect(result).toMatchObject({
      oauthToken: expect.stringMatching(/^sk-ant-oat/),
    });
    await subprocessClaudeRunner.dispose({ runnerId });
  });

  it("reports failure on a rejected code", async () => {
    vi.stubEnv("CLAUDE_CONNECTION_RUNNER_ARGS", JSON.stringify([fakePath]));
    const { runnerId } = await subprocessClaudeRunner.start({
      sessionId: "s-bad",
    });
    await subprocessClaudeRunner.submitCode({ runnerId, code: "nope" });
    const result = await pollUntilTerminal(runnerId);
    expect(result.status).toBe("failed");
    await subprocessClaudeRunner.dispose({ runnerId });
  });

  it("throws if the process exits before printing a URL", async () => {
    vi.stubEnv("CLAUDE_CONNECTION_RUNNER_ARGS", JSON.stringify([exitPath]));
    await expect(
      subprocessClaudeRunner.start({ sessionId: "s-exit" }),
    ).rejects.toThrow();
  });
});
