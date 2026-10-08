import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PROVISION_SCRIPT,
  readPins,
  writePins,
} from "./scripts/agent-cli-pins.mjs";
import {
  MIN_AGE_MS,
  chooseCursorVersion,
  chooseNpmVersion,
  parseRequirements,
} from "./scripts/update-agent-clis.mjs";

const now = Date.parse("2026-10-08T18:00:00Z");
const daysAgo = (days) => new Date(now - days * 86_400_000).toISOString();
const times = {
  created: daysAgo(400),
  "2.1.236": daysAgo(50),
  "2.1.280": daysAgo(16),
  "2.1.286": daysAgo(8),
  "2.1.290": daysAgo(3),
  "2.1.293": daysAgo(1),
  "2.1.294": daysAgo(0.5),
  "2.2.0-beta.1": daysAgo(4),
};

test("takes the newest stable release at least two days old, within the ceiling", () => {
  assert.equal(
    chooseNpmVersion({ times, ceiling: "2.1.294", current: "2.1.236", now }),
    "2.1.290",
  );
  assert.equal(
    chooseNpmVersion({ times, ceiling: "2.1.286", current: "2.1.236", now }),
    "2.1.286",
  );
});

test("never downgrades and ignores prereleases", () => {
  assert.equal(
    chooseNpmVersion({ times, ceiling: "2.1.294", current: "2.1.293", now }),
    "2.1.293",
  );
});

test("a required version overrides the delay with the oldest satisfying release", () => {
  assert.equal(
    chooseNpmVersion({
      times,
      ceiling: "2.1.286",
      current: "2.1.236",
      required: "2.1.291",
      now,
    }),
    "2.1.293",
  );
  assert.equal(
    chooseNpmVersion({
      times,
      ceiling: "2.1.294",
      current: "2.1.236",
      required: "latest",
      now,
    }),
    "2.1.294",
  );
  assert.throws(
    () =>
      chooseNpmVersion({
        times,
        ceiling: "2.1.294",
        current: "2.1.236",
        required: "9.0.0",
        now,
      }),
    /No published release satisfies 9.0.0/,
  );
});

test("a satisfied requirement does not move the pin past the delay", () => {
  assert.equal(
    chooseNpmVersion({
      times,
      ceiling: "2.1.294",
      current: "2.1.236",
      required: "2.1.280",
      now,
    }),
    "2.1.290",
  );
});

test("Cursor releases age by the date in their version", () => {
  const current = "2026.10.01-e373342";
  const choose = (latest, required) =>
    chooseCursorVersion({
      latest,
      current,
      required,
      now,
      minAgeMs: MIN_AGE_MS,
    });
  assert.equal(choose("2026.10.05-aaaaaaa"), "2026.10.05-aaaaaaa");
  assert.equal(choose("2026.10.07-bbbbbbb"), current);
  assert.equal(choose("2026.10.07-bbbbbbb", "latest"), "2026.10.07-bbbbbbb");
  assert.equal(choose("2026.09.30-ccccccc"), current);
});

test("requirements name a known CLI and a version", () => {
  assert.deepEqual(parseRequirements(["claude-code=2.1.280", "codex=latest"]), {
    "claude-code": "2.1.280",
    codex: "latest",
  });
  assert.throws(() => parseRequirements(["npm=1.0.0"]), /Invalid requirement/);
});

test("the image script's pins parse and rewrite in place", () => {
  const script = readFileSync(PROVISION_SCRIPT, "utf8");
  const pins = readPins(script);
  assert.match(pins.codex, /^\d+\.\d+\.\d+$/);
  assert.match(pins.claudeCode, /^\d+\.\d+\.\d+$/);
  assert.match(pins.cursorSha256, /^[0-9a-f]{64}$/);
  const next = { ...pins, codex: "9.9.9", cursorSha256: "f".repeat(64) };
  const rewritten = writePins(script, next);
  assert.deepEqual(readPins(rewritten), next);
  // Only the pinned values change.
  assert.equal(
    rewritten
      .split("\n")
      .filter((line, index) => line !== script.split("\n")[index]).length,
    2,
  );
});
