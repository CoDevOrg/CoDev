import { describe, expect, it } from "vitest";

import {
  classifyFilesystemReconciliation,
  collaborativeConflictRevision,
} from "./collaboration-server";

describe("filesystem collaboration reconciliation", () => {
  it("ingests an external edit when the collaborative copy is unchanged", () => {
    expect(
      classifyFilesystemReconciliation({
        snapshotContents: "before",
        collaborativeContents: "before",
        snapshotRevision: "r1",
        filesystemRevision: "r2",
      }),
    ).toBe("ingest");
  });

  it("reports a conflict when both copies changed", () => {
    expect(
      classifyFilesystemReconciliation({
        snapshotContents: "before",
        collaborativeContents: "local edit",
        snapshotRevision: "r1",
        filesystemRevision: "r2",
      }),
    ).toBe("conflict");
  });

  it("stamps a stable editor revision that is distinct from the filesystem", () => {
    expect(collaborativeConflictRevision("local edit")).toBe(
      collaborativeConflictRevision("local edit"),
    );
    expect(collaborativeConflictRevision("local edit")).not.toBe(
      collaborativeConflictRevision("terminal edit"),
    );
    expect(collaborativeConflictRevision("local edit")).toMatch(
      /^editor-[0-9a-f]{24}$/,
    );
  });

  it("does not reconcile an unchanged filesystem revision", () => {
    expect(
      classifyFilesystemReconciliation({
        snapshotContents: "before",
        collaborativeContents: "local edit",
        snapshotRevision: "r1",
        filesystemRevision: "r1",
      }),
    ).toBe("unchanged");
  });
});
