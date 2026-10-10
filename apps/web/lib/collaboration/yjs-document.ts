import { createHash } from "node:crypto";

import * as Y from "yjs";

import { diffTextHunks, type TextHunk } from "./text-diff";
import { rebaseTextHunks } from "./text-merge";

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
 * Applies hunks (ascending, in the current text's positions) as one
 * filesystem-origin transaction and returns their spans in the new text.
 */
function applyDocumentHunks(doc: Y.Doc, hunks: TextHunk[]) {
  const text = doc.getText("content");
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

/** Makes the shared text equal `contents`, touching only changed lines. */
export function replaceDocumentContents(doc: Y.Doc, contents: string) {
  const current = doc.getText("content").toString();
  return applyDocumentHunks(doc, diffTextHunks(current, contents));
}

/**
 * Brings a file change (`base` to `theirs`) into a document that has edits
 * of its own, keeping both. Null when both changed the same lines.
 */
export function mergeDocumentContents(
  doc: Y.Doc,
  base: string,
  theirs: string,
) {
  const ours = doc.getText("content").toString();
  const hunks = rebaseTextHunks(base, ours, theirs);
  return hunks ? applyDocumentHunks(doc, hunks) : null;
}

export function encodedDocument(doc: Y.Doc) {
  return {
    update: encodeBase64(Y.encodeStateAsUpdate(doc)),
    stateVector: encodeBase64(Y.encodeStateVector(doc)),
  };
}
