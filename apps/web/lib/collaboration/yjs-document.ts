import { createHash } from "node:crypto";

import * as Y from "yjs";

/** Browser- and runtime-agnostic Yjs document primitives shared by workspace adapters. */
export function classifyFilesystemReconciliation(input: {
  snapshotContents: string;
  collaborativeContents: string;
  snapshotRevision: string;
  filesystemRevision: string;
}) {
  if (input.snapshotRevision === input.filesystemRevision) {
    return "unchanged" as const;
  }
  return input.collaborativeContents === input.snapshotContents
    ? ("ingest" as const)
    : ("conflict" as const);
}

export function collaborativeConflictRevision(contents: string): string {
  return `editor-${createHash("sha256").update(contents).digest("hex").slice(0, 24)}`;
}

export function decodeBase64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function encodeBase64(value: Uint8Array) {
  return Buffer.from(value).toString("base64");
}

export function docFromUpdate(update: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decodeBase64(update), "snapshot");
  return doc;
}

export function replaceDocumentContents(doc: Y.Doc, contents: string) {
  const text = doc.getText("content");
  doc.transact(() => {
    text.delete(0, text.length);
    text.insert(0, contents);
  }, "filesystem");
}

export function encodedDocument(doc: Y.Doc) {
  return {
    update: encodeBase64(Y.encodeStateAsUpdate(doc)),
    stateVector: encodeBase64(Y.encodeStateVector(doc)),
  };
}
