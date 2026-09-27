import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  classifyFilesystemReconciliation,
  docFromUpdate,
  encodedDocument,
  replaceDocumentContents,
} from "./yjs-document";

describe("shared Yjs document primitives", () => {
  it("preserves a document through a serializable snapshot", () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "shared text");

    const restored = docFromUpdate(encodedDocument(doc).update);

    expect(restored.getText("content").toString()).toBe("shared text");
  });

  it("only ingests a filesystem change when no collaborative edit is pending", () => {
    expect(
      classifyFilesystemReconciliation({
        snapshotContents: "on disk",
        collaborativeContents: "on disk",
        snapshotRevision: "rev-1",
        filesystemRevision: "rev-2",
      }),
    ).toBe("ingest");
    expect(
      classifyFilesystemReconciliation({
        snapshotContents: "on disk",
        collaborativeContents: "member edit",
        snapshotRevision: "rev-1",
        filesystemRevision: "rev-2",
      }),
    ).toBe("conflict");
  });

  it("replaces the shared text as one filesystem-origin transaction", () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "before");

    replaceDocumentContents(doc, "after");

    expect(doc.getText("content").toString()).toBe("after");
  });
});
