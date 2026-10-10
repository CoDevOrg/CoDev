"use client";

import { useEffect, useRef } from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import type * as Y from "yjs";

import { gen2LanguageExtension } from "./editor-languages";
import {
  supersetEditorTheme,
  supersetHighlighting,
} from "./superset-editor-theme";
import { buildFoldChevron } from "../../../../vendor/superset/apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/views/CodeView/components/CodeEditor/extensions/foldChevron/foldChevron";

export type EditorRevealRange = {
  id: number;
  line: number;
  endLine?: number | undefined;
};

export type EditorSelectionText = {
  startLine: number;
  endLine: number;
  text: string;
};

const MAX_SELECTION_CHARS = 2_000;
/** A view rebuilt soon after a reveal (the shared document connecting) gets it again. */
const REVEAL_CARRY_MS = 3_000;

function selectionText(state: EditorState): EditorSelectionText | null {
  const { from, to, empty } = state.selection.main;
  if (empty) return null;
  return {
    startLine: state.doc.lineAt(from).number,
    endLine: state.doc.lineAt(to).number,
    text: state.sliceDoc(from, to).slice(0, MAX_SELECTION_CHARS),
  };
}

/** Selects the lines and scrolls them into view; never takes focus. */
function revealLines(view: EditorView, range: EditorRevealRange) {
  const { doc } = view.state;
  const first = Math.min(range.line, doc.lines);
  const last = Math.min(Math.max(range.endLine ?? first, first), doc.lines);
  const from = doc.line(first).from;
  view.dispatch({
    selection: { anchor: from, head: doc.line(last).to },
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  });
}

/**
 * Browser-safe adaptation of Superset's CodeEditor. Desktop font settings,
 * Electron tRPC, and desktop theme stores are intentionally replaced by the
 * CoDev web theme and a small props-only boundary.
 */
export function SupersetCodeEditor({
  path,
  value,
  readOnly = false,
  onChange,
  onSave,
  sharedText,
  onSelectionChange,
  onSelectionText,
  revealRange,
  onRangeRevealed,
}: {
  path: string;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  /** A CoDev Y.Text makes this CodeMirror view a collaborative editor. */
  sharedText?: Y.Text | null;
  onSelectionChange?: (selection: { anchor: number; head: number }) => void;
  /** The selected lines and text, or null when nothing is selected. */
  onSelectionText?:
    | ((selection: EditorSelectionText | null) => void)
    | undefined;
  /** Lines to select and scroll to, once per `id`. */
  revealRange?: EditorRevealRange | null | undefined;
  /** Called once a range is shown, so its request can be cleared. */
  onRangeRevealed?: ((id: number) => void) | undefined;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSelectionTextRef = useRef(onSelectionText);
  const onRangeRevealedRef = useRef(onRangeRevealed);
  const revealedRef = useRef<{
    range: EditorRevealRange;
    view: EditorView;
    at: number;
  }>(null);
  const syncingValueRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    onSelectionChangeRef.current = onSelectionChange;
    onSelectionTextRef.current = onSelectionText;
    onRangeRevealedRef.current = onRangeRevealed;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const language = languageRef.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: sharedText?.toString() ?? value,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          foldGutter({ markerDOM: buildFoldChevron }),
          codeFolding(),
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          indentUnit.of("  "),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: "false" }),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          supersetEditorTheme,
          supersetHighlighting,
          language.of([]),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet) {
              const selection = update.state.selection.main;
              onSelectionChangeRef.current?.({
                anchor: selection.anchor,
                head: selection.head,
              });
              onSelectionTextRef.current?.(selectionText(update.state));
            }
            if (!update.docChanged || syncingValueRef.current) return;
            if (!sharedText) {
              onChangeRef.current(update.state.doc.toString());
              return;
            }
            sharedText.doc?.transact(() => {
              let offset = 0;
              update.changes.iterChanges(
                (fromA, toA, _fromB, _toB, inserted) => {
                  const from = fromA + offset;
                  const deleted = toA - fromA;
                  const insertedText = inserted.toString();
                  if (deleted > 0) sharedText.delete(from, deleted);
                  if (insertedText) sharedText.insert(from, insertedText);
                  offset += insertedText.length - deleted;
                },
              );
            }, "codev-editor");
          }),
        ],
      }),
    });
    viewRef.current = view;

    const applySharedChanges = (event: Y.YTextEvent) => {
      onChangeRef.current(sharedText?.toString() ?? view.state.doc.toString());
      if (event.transaction.origin === "codev-editor") return;
      syncingValueRef.current = true;
      try {
        let position = 0;
        for (const delta of event.delta) {
          if (typeof delta.retain === "number") {
            position += delta.retain;
          } else if (typeof delta.delete === "number") {
            view.dispatch({
              changes: { from: position, to: position + delta.delete },
            });
          } else if (typeof delta.insert === "string") {
            view.dispatch({
              changes: { from: position, insert: delta.insert },
            });
            position += delta.insert.length;
          }
        }
      } finally {
        syncingValueRef.current = false;
      }
    };
    if (sharedText) sharedText.observe(applySharedChanges);

    let cancelled = false;
    void gen2LanguageExtension(path).then((extension) => {
      if (!cancelled && extension) {
        view.dispatch({ effects: language.reconfigure(extension) });
      }
    });

    return () => {
      cancelled = true;
      if (sharedText) sharedText.unobserve(applySharedChanges);
      viewRef.current = null;
      view.destroy();
    };
    // A changed path intentionally constructs a new editor, separating undo
    // history between files just as the Superset pane does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, sharedText]);

  useEffect(() => {
    const view = viewRef.current;
    const last = revealedRef.current;
    if (!view) return;
    if (revealRange && revealRange.id !== last?.range.id) {
      revealLines(view, revealRange);
      revealedRef.current = { range: revealRange, view, at: Date.now() };
      onRangeRevealedRef.current?.(revealRange.id);
      return;
    }
    // The request is cleared once shown; a view rebuilt soon after (the
    // shared document connecting) still gets the same lines from here.
    if (!last || last.view === view || Date.now() - last.at > REVEAL_CARRY_MS)
      return;
    revealLines(view, last.range);
    revealedRef.current = { ...last, view };
  }, [revealRange, path, sharedText]);

  useEffect(() => {
    const view = viewRef.current;
    if (sharedText || !view || view.state.doc.toString() === value) return;
    syncingValueRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    } finally {
      syncingValueRef.current = false;
    }
  }, [sharedText, value]);

  return <div ref={hostRef} className="gen2-superset-code-editor" />;
}
