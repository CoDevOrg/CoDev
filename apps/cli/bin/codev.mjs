#!/usr/bin/env node

import { claudeAuth, codexAuth, login } from "../src/client.mjs";

function help() {
  process.stdout.write(`CoDev CLI

Usage:
  codev login [--no-browser]
  codev codex-auth [--org[=<workspace-id>]] [--browser]
  codev claude-auth [--org[=<workspace-id>]]

The codex-auth and claude-auth commands delegate authentication to the
official Codex and Claude Code CLIs. No provider API key is required.
`);
}

function orgArgument(args) {
  const inline = args.find((value) => value.startsWith("--org="));
  if (inline) return { organization: true, organizationId: inline.slice(6) };
  return { organization: args.includes("--org") };
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    help();
    return;
  }
  if (command === "login") {
    await login({ launchBrowser: !args.includes("--no-browser") });
    return;
  }
  if (command === "codex-auth") {
    await codexAuth({
      ...orgArgument(args),
      browser: args.includes("--browser"),
    });
    return;
  }
  if (command === "claude-auth") {
    await claudeAuth(orgArgument(args));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Command failed."}\n`,
  );
  process.exitCode = 1;
});
