import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

import { agentTypingField } from "./codemirror-agent-typing";

/** Someone else's caret and selection in this file: a person or an agent. */
export interface RemoteCursor {
  id: string;
  label: string;
  color: string;
  kind: "person" | "agent";
  anchor: number;
  head: number;
}

export const setRemoteCursors = StateEffect.define<RemoteCursor[]>();

class CaretWidget extends WidgetType {
  constructor(
    readonly cursor: RemoteCursor,
    /** Changes on every move, so the label shows again after one. */
    readonly movedAt: number,
  ) {
    super();
  }

  eq(other: CaretWidget) {
    return (
      other.cursor.id === this.cursor.id &&
      other.cursor.label === this.cursor.label &&
      other.movedAt === this.movedAt
    );
  }

  toDOM() {
    const caret = document.createElement("span");
    caret.className = "cm-remote-caret";
    caret.dataset.kind = this.cursor.kind;
    caret.style.setProperty("--member-color", this.cursor.color);
    caret.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "cm-remote-caret-label";
    label.textContent = this.cursor.label;
    caret.appendChild(label);
    return caret;
  }

  ignoreEvent() {
    return true;
  }
}

type Tracked = RemoteCursor & { movedAt: number };

const clamp = (position: number, length: number) =>
  Math.max(0, Math.min(position, length));

/** Places incoming cursors, remembering when each one last moved. */
function place(previous: Tracked[], next: RemoteCursor[], length: number) {
  return next.map((cursor) => {
    const anchor = clamp(cursor.anchor, length);
    const head = clamp(cursor.head, length);
    const before = previous.find((entry) => entry.id === cursor.id);
    const moved = !before || before.head !== head || before.anchor !== anchor;
    return {
      ...cursor,
      anchor,
      head,
      movedAt: moved ? Date.now() : before.movedAt,
    };
  });
}

function decorate(cursors: Tracked[]) {
  const ranges: Range<Decoration>[] = [];
  for (const cursor of cursors) {
    const from = Math.min(cursor.anchor, cursor.head);
    const to = Math.max(cursor.anchor, cursor.head);
    if (from < to)
      ranges.push(
        Decoration.mark({
          class: "cm-remote-selection",
          attributes: { style: `--member-color: ${cursor.color}` },
        }).range(from, to),
      );
    ranges.push(
      Decoration.widget({
        widget: new CaretWidget(cursor, cursor.movedAt),
        side: 1,
      }).range(cursor.head),
    );
  }
  return Decoration.set(ranges, true);
}

/** Other members' and agents' cursors, kept in place as the text changes. */
const remoteCursorsField = StateField.define<Tracked[]>({
  create: () => [],
  update(cursors, transaction) {
    let next = transaction.docChanged
      ? cursors.map((cursor) => ({
          ...cursor,
          anchor: transaction.changes.mapPos(cursor.anchor),
          head: transaction.changes.mapPos(cursor.head),
        }))
      : cursors;
    for (const effect of transaction.effects)
      if (effect.is(setRemoteCursors))
        next = place(next, effect.value, transaction.newDoc.length);
    return next;
  },
});

/**
 * Remote carets and selections. An agent that is visibly typing shows its
 * caret at the typing point instead, so it never appears twice.
 */
export const remoteCursors = [
  remoteCursorsField,
  EditorView.decorations.compute(
    [remoteCursorsField, agentTypingField],
    (state) => {
      const typing = state.field(agentTypingField, false)?.reveals ?? [];
      return decorate(
        state
          .field(remoteCursorsField)
          .filter(
            (cursor) => !typing.some((reveal) => reveal.id === cursor.id),
          ),
      );
    },
  ),
];
