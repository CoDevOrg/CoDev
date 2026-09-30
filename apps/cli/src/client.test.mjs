import test from "node:test";
import assert from "node:assert/strict";

import {
  apiUrl,
  configPath,
  describeSpawnError,
  extractClaudeOAuthToken,
} from "./client.mjs";

test("uses an explicit CoDev API URL without a trailing slash", () => {
  assert.equal(
    apiUrl({ CODEV_API_URL: "https://example.test/" }),
    "https://example.test",
  );
});

test("keeps CLI credentials inside the configured private directory", () => {
  assert.equal(
    configPath({ CODEV_CONFIG_DIR: "/tmp/codev-test" }),
    "/tmp/codev-test/config.json",
  );
});

test("extracts a Claude OAuth token from setup-token output", () => {
  assert.equal(
    extractClaudeOAuthToken(
      "Login successful.\nToken: sk-ant-oat01-abc123XYZ_-4567890\nDone.",
    ),
    "sk-ant-oat01-abc123XYZ_-4567890",
  );
  assert.equal(extractClaudeOAuthToken("no token here"), undefined);
});

test("explains a missing codex/claude binary with an install hint", () => {
  const error = describeSpawnError("codex", { code: "ENOENT" });
  assert.match(error.message, /npm install -g @openai\/codex/);
  assert.match(error.message, /npm config set prefix/);
});

test("passes through non-ENOENT spawn errors unchanged", () => {
  const original = new Error("boom");
  assert.equal(describeSpawnError("codex", original), original);
});
