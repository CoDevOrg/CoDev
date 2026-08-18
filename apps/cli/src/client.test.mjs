import test from "node:test";
import assert from "node:assert/strict";

import { apiUrl, configPath } from "./client.mjs";

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
