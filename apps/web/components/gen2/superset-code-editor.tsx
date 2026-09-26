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

import { gen2LanguageExtension } from "./editor-languages";
import {
  buildSupersetFoldChevron,
  supersetEditorTheme,
  supersetHighlighting,
} from "./superset-editor-theme";

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
}: {
  path: string;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const syncingValueRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const language = languageRef.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          foldGutter({ markerDOM: buildSupersetFoldChevron }),
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
            if (update.docChanged && !syncingValueRef.current)
              onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;

    let cancelled = false;
    void gen2LanguageExtension(path).then((extension) => {
      if (!cancelled && extension) {
        view.dispatch({ effects: language.reconfigure(extension) });
      }
    });

    return () => {
      cancelled = true;
      viewRef.current = null;
      view.destroy();
    };
    // A changed path intentionally constructs a new editor, separating undo
    // history between files just as the Superset pane does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncingValueRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    } finally {
      syncingValueRef.current = false;
    }
  }, [value]);

  return <div ref={hostRef} className="gen2-superset-code-editor" />;
}
