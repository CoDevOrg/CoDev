// Keeps the ARM image's agent CLIs current: the newest release that is at
// least two days old, so a broken or compromised release is usually caught
// upstream first. A model that needs a newer CLI overrides the delay with the
// oldest release that satisfies it. Pins only move forward.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROVISION_SCRIPT, readPins, writePins } from "./agent-cli-pins.mjs";

export const MIN_AGE_MS = 2 * 24 * 60 * 60_000;
const STABLE = /^\d+\.\d+\.\d+$/;
const CURSOR = /^(\d{4})\.(\d{2})\.(\d{2})-[0-9a-f]+$/;

export function compare(a, b) {
  const [x, y] = [a, b].map((value) => value.split(".").map(Number));
  for (let index = 0; index < 3; index++)
    if (x[index] !== y[index]) return x[index] - y[index];
  return 0;
}

const newest = (versions) =>
  versions.reduce(
    (best, version) => (!best || compare(version, best) > 0 ? version : best),
    undefined,
  );

/** `required` is a version or "latest" (the provider named no version). */
export function chooseNpmVersion({
  times,
  ceiling,
  current,
  required,
  now,
  minAgeMs = MIN_AGE_MS,
}) {
  const stable = Object.keys(times).filter((version) => STABLE.test(version));
  const capped = stable.filter((version) => compare(version, ceiling) <= 0);
  const aged = capped.filter(
    (version) => now - Date.parse(times[version]) >= minAgeMs,
  );
  let chosen = newest([current, ...aged]);
  if (required === "latest") chosen = newest([chosen, ...capped]);
  else if (required && compare(required, chosen) > 0) {
    const satisfying = stable.filter(
      (version) => compare(version, required) >= 0,
    );
    if (!satisfying.length)
      throw new Error(`No published release satisfies ${required}.`);
    chosen = satisfying.reduce((oldest, version) =>
      compare(version, oldest) < 0 ? version : oldest,
    );
  }
  return chosen;
}

const cursorDate = (version) => {
  const match = version.match(CURSOR);
  if (!match) throw new Error(`Unexpected Cursor version ${version}.`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

/** Cursor publishes only its current release; its version starts with the release date. */
export function chooseCursorVersion({
  latest,
  current,
  required,
  now,
  minAgeMs = MIN_AGE_MS,
}) {
  if (cursorDate(latest) <= cursorDate(current)) return current;
  return required || now - cursorDate(latest) >= minAgeMs ? latest : current;
}

async function fetchOk(url, init) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
    ...init,
  });
  if (!response.ok)
    throw new Error(`${new URL(url).host} returned ${response.status}.`);
  return response;
}

async function npmVersion(name, pin, tag, required, now) {
  const document = await (
    await fetchOk(`https://registry.npmjs.org/${name}`)
  ).json();
  const ceiling = document["dist-tags"][tag] ?? document["dist-tags"].latest;
  return chooseNpmVersion({
    times: document.time,
    ceiling,
    current: pin,
    required,
    now,
  });
}

async function cursorPins(pins, required, now) {
  // Read only the version from Cursor's install script; never run it.
  const script = await (await fetchOk("https://cursor.com/install")).text();
  const latest = script.match(/downloads\.cursor\.com\/lab\/([^/]+)\//)?.[1];
  if (!latest) throw new Error("Cursor's install script names no release.");
  const version = chooseCursorVersion({
    latest,
    current: pins.cursorVersion,
    required,
    now,
  });
  if (version === pins.cursorVersion) return pins;
  const tarball = await fetchOk(
    `https://downloads.cursor.com/lab/${version}/linux/arm64/agent-cli-package.tar.gz`,
  );
  const sha256 = createHash("sha256")
    .update(Buffer.from(await tarball.arrayBuffer()))
    .digest("hex");
  return { ...pins, cursorVersion: version, cursorSha256: sha256 };
}

export function parseRequirements(values) {
  return Object.fromEntries(
    values.map((value) => {
      const [name, version] = value.split("=");
      if (!["codex", "claude-code", "cursor"].includes(name) || !version)
        throw new Error(
          `Invalid requirement ${value}; use codex|claude-code|cursor=<version|latest>.`,
        );
      return [name, version];
    }),
  );
}

async function main() {
  const required = parseRequirements(
    process.argv.slice(2).filter((arg) => arg.includes("=")),
  );
  const now = Date.now();
  const script = readFileSync(PROVISION_SCRIPT, "utf8");
  const pins = readPins(script);
  const next = {
    ...(await cursorPins(pins, required.cursor, now)),
    codex: await npmVersion(
      "@openai/codex",
      pins.codex,
      "latest",
      required.codex,
      now,
    ),
    claudeCode: await npmVersion(
      "@anthropic-ai/claude-code",
      pins.claudeCode,
      "stable",
      required["claude-code"],
      now,
    ),
  };
  const changes = Object.keys(next).filter((name) => next[name] !== pins[name]);
  if (changes.length) writeFileSync(PROVISION_SCRIPT, writePins(script, next));
  const summary = changes.map(
    (name) => `${name}: ${pins[name]} -> ${next[name]}`,
  );
  console.log(summary.length ? summary.join("\n") : "Agent CLIs are current.");
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=${changes.length > 0}\nsummary=${summary.join("; ")}\n`,
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
