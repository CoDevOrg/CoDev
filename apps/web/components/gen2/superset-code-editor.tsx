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
}: {
  path: string;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  /** A CoDev Y.Text makes this CodeMirror view a collaborative editor. */
  sharedText?: Y.Text | null;
  onSelectionChange?: (selection: { anchor: number; head: number }) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const syncingValueRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    onSelectionChangeRef.current = onSelectionChange;
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
