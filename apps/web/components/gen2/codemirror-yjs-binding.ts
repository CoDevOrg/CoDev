import { Annotation, type ChangeSpec } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type * as Y from "yjs";

/** Yjs origin of local CodeMirror edits, so they are not applied twice. */
export const EDITOR_ORIGIN = "codev-editor";

/** The Yjs origin of an agent's edit, which editors animate. */
export interface AgentEditOrigin {
  agent: true;
  /** The agent session, matching its presence cursor. */
  id: string;
  label: string;
  color: string;
}

export function isAgentEditOrigin(origin: unknown): origin is AgentEditOrigin {
  return (
    typeof origin === "object" &&
    origin !== null &&
    (origin as { agent?: unknown }).agent === true
  );
}

/** Marks a CodeMirror transaction that mirrors a remote Yjs change. */
export const remoteEdit = Annotation.define<{ origin: unknown }>();

export function isRemoteUpdate(update: ViewUpdate) {
  return update.transactions.some(
    (transaction) => transaction.annotation(remoteEdit) !== undefined,
  );
}

/** A Yjs text delta as changes against the document before it. */
export function deltaToChanges(delta: Y.YTextEvent["delta"]): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  let position = 0;
  for (const op of delta) {
    if (typeof op.retain === "number") position += op.retain;
    else if (typeof op.delete === "number") {
      changes.push({ from: position, to: position + op.delete });
      position += op.delete;
    } else if (typeof op.insert === "string")
      changes.push({ from: position, insert: op.insert });
  }
  return changes;
}

/** Copies a local CodeMirror change into the shared text. */
export function applyViewUpdate(text: Y.Text, update: ViewUpdate) {
  text.doc?.transact(() => {
    let offset = 0;
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const from = fromA + offset;
      const deleted = toA - fromA;
      const insertedText = inserted.toString();
      if (deleted > 0) text.delete(from, deleted);
      if (insertedText) text.insert(from, insertedText);
      offset += insertedText.length - deleted;
    });
  }, EDITOR_ORIGIN);
}

/**
 * Mirrors remote Yjs changes into the view as one transaction each, tagged
 * with their origin. Returns the unsubscribe.
 */
export function observeSharedText(
  view: EditorView,
  text: Y.Text,
  onText: (contents: string) => void,
) {
  const observer = (event: Y.YTextEvent) => {
    onText(text.toString());
    const origin = event.transaction.origin;
    if (origin === EDITOR_ORIGIN) return;
    view.dispatch({
      changes: deltaToChanges(event.delta),
      annotations: remoteEdit.of({ origin }),
    });
  };
  text.observe(observer);
  return () => text.unobserve(observer);
}
