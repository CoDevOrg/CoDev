import { createHash } from "node:crypto";

import * as Y from "yjs";

import { diffTextHunks } from "./text-diff";

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

/**
 * Applies only the changed lines as one filesystem-origin transaction and
 * returns the changed spans in the new text, first to last.
 */
export function replaceDocumentContents(doc: Y.Doc, contents: string) {
  const text = doc.getText("content");
  const hunks = diffTextHunks(text.toString(), contents);
  doc.transact(() => {
    for (const hunk of [...hunks].reverse()) {
      if (hunk.to > hunk.from) text.delete(hunk.from, hunk.to - hunk.from);
      if (hunk.insert) text.insert(hunk.from, hunk.insert);
    }
  }, "filesystem");
  let shift = 0;
  return hunks.map((hunk) => {
    const from = hunk.from + shift;
    shift += hunk.insert.length - (hunk.to - hunk.from);
    return { from, to: from + hunk.insert.length };
  });
}

export function encodedDocument(doc: Y.Doc) {
  return {
    update: encodeBase64(Y.encodeStateAsUpdate(doc)),
    stateVector: encodeBase64(Y.encodeStateVector(doc)),
  };
}
