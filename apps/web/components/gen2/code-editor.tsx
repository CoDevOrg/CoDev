"use client";

import { useEffect, useImperativeHandle, useRef } from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";

import { gen2LanguageExtension } from "./editor-languages";
import { gen2EditorTheme, gen2Highlighting } from "./editor-theme";

export type Gen2EditorHandle = {
  /** Replace the document without losing the selection or scroll position. */
  replaceDoc(next: string): void;
  focus(): void;
};

/**
 * The editor is uncontrolled: CodeMirror owns the document and reports
 * changes upward. Routing every keystroke through React state would
 * re-render the pane at typing speed for no benefit.
 */
export function Gen2CodeEditor({
  path,
  initialDoc,
  readOnly,
  onChange,
  onSave,
  handleRef,
}: {
  path: string;
  initialDoc: string;
  readOnly: boolean;
  onChange: (doc: string) => void;
  onSave: () => void;
  handleRef?: React.RefObject<Gen2EditorHandle | null>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Held in refs so the effect below never re-runs on a new closure and tears
  // the editor down mid-edit.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const languageRef = useRef(new Compartment());
  const readOnlyRef = useRef(new Compartment());

  // Refreshed after every render rather than during it, so the editor's own
  // effect below never tears down and rebuilds on a new callback identity.
  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  });

  useImperativeHandle(handleRef, () => ({
    replaceDoc(next: string) {
      const view = viewRef.current;
      if (!view || view.state.doc.toString() === next) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
    },
    focus() {
      viewRef.current?.focus();
    },
  }));

  // One EditorView per open file. Keying the mount on `path` keeps undo
  // history from leaking between files.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const language = languageRef.current;
    const editable = readOnlyRef.current;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          foldGutter(),
          history(),
          drawSelection(),
          rectangularSelection(),
          indentOnInput(),
          bracketMatching(),
          indentUnit.of("  "),
          EditorView.lineWrapping,
          gen2EditorTheme,
          gen2Highlighting,
          language.of([]),
          editable.of(EditorState.readOnly.of(false)),
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
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    let cancelled = false;
    void gen2LanguageExtension(path).then((extension) => {
      if (cancelled || !extension) return;
      view.dispatch({ effects: language.reconfigure(extension) });
    });

    return () => {
      cancelled = true;
      viewRef.current = null;
      view.destroy();
    };
    // `initialDoc` is intentionally excluded: reopening the same path with
    // new contents goes through `replaceDoc`, which preserves the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyRef.current.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    });
  }, [readOnly]);

  return <div className="gen2-editor-host" ref={hostRef} />;
}
