import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../drizzle/0046_smooth_patriot.sql", import.meta.url),
);
const migration = readFileSync(migrationPath, "utf8");

describe("session import lifecycle migration", () => {
  it("allows only one active exact native writer", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "agent_session_imports_active_writer_idx"',
    );
    expect(migration).toContain(
      '("imported_by","source_provider","external_session_id")',
    );
    expect(migration).toContain("\"continuation_mode\" = 'native_resume'");
    expect(migration).toContain("in ('launching', 'active')");
    expect(migration).toContain('"deleted_at" is null');
  });
});
