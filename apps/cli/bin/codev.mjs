#!/usr/bin/env node

import { claudeAuth, codexAuth, cursorAuth, login } from "../src/client.mjs";

function help() {
  process.stdout.write(`CoDev CLI

Usage:
  codev login [--no-browser]
  codev codex-auth [--browser]
  codev claude-auth
  codev cursor-auth

The auth commands delegate authentication to the official Codex, Claude
Code, and Cursor CLIs. No provider API key is required.
`);
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
      browser: args.includes("--browser"),
    });
    return;
  }
  if (command === "claude-auth") {
    await claudeAuth();
    return;
  }
  if (command === "cursor-auth") {
    await cursorAuth();
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
