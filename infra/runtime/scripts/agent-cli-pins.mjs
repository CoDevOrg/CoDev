// The agent CLI pins live in the ARM image provisioning script. The updater
// rewrites them and CI's compatibility job installs exactly these versions.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PROVISION_SCRIPT = fileURLToPath(
  new URL("./provision-arm-workspace-image.sh", import.meta.url),
);

const PATTERNS = {
  codex: /@openai\/codex@(\d+\.\d+\.\d+)/,
  claudeCode: /@anthropic-ai\/claude-code@(\d+\.\d+\.\d+)/,
  cursorVersion: /readonly cursor_version="([^"]+)"/,
  cursorSha256: /readonly cursor_sha256="([0-9a-f]{64})"/,
};

export function readPins(script) {
  const pins = {};
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    const match = script.match(pattern);
    if (!match) throw new Error(`Agent CLI pin ${name} not found.`);
    pins[name] = match[1];
  }
  return pins;
}

export function writePins(script, pins) {
  return Object.entries(PATTERNS).reduce(
    (text, [name, pattern]) =>
      text.replace(pattern, (whole, value) => whole.replace(value, pins[name])),
    script,
  );
}

// `node agent-cli-pins.mjs` prints the pins as shell assignments for CI.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pins = readPins(readFileSync(PROVISION_SCRIPT, "utf8"));
  for (const [name, value] of Object.entries(pins))
    console.log(`${name}=${value}`);
}
