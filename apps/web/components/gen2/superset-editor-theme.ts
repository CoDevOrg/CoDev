import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const editorFont =
  "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

/**
 * CodeMirror theme bound to the workspace `--ws-*` tokens so the editor
 * matches shell, chat, and inspector surfaces. Keep this engine; only the
 * palette and type metrics change here.
 */
export const supersetEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--ws-surface-1)",
    color: "var(--ws-text-primary)",
    fontFamily: editorFont,
    fontSize: "13px",
  },
  ".cm-scroller": { lineHeight: "20px", overflow: "auto" },
  ".cm-content": { padding: "8px 0", caretColor: "var(--ws-text-primary)" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": {
    backgroundColor: "var(--ws-surface-1)",
    color: "var(--ws-text-muted)",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 2px 0 8px" },
  ".cm-gutterElement": { lineHeight: "20px" },
  ".cm-foldGutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 2px",
  },
  ".cm-foldChevron": {
    width: "12px",
    height: "12px",
    display: "block",
    opacity: 0,
    transition: "opacity 160ms ease",
  },
  ".cm-gutters:hover .cm-foldChevron": { opacity: 1 },
  ".cm-foldGutter .cm-gutterElement:has(.cm-foldChevron)": {
    cursor: "pointer",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--ws-surface-2)",
    border: "1px solid var(--ws-border-subtle)",
    borderRadius: "6px",
    color: "var(--ws-text-secondary)",
    cursor: "pointer",
    margin: "0 2px",
    padding: "0 3px",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "var(--ws-surface-hover)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--ws-accent-soft)",
    },
  ".cm-selectionMatch, .cm-searchMatch": {
    backgroundColor: "var(--ws-accent-soft)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--ws-accent)",
    color: "var(--ws-text-inverse)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ws-text-primary)" },
  ".cm-panels": {
    backgroundColor: "var(--ws-surface-2)",
    color: "var(--ws-text-primary)",
    borderBottom: "1px solid var(--ws-border-subtle)",
  },
  ".cm-panels .cm-textfield": {
    backgroundColor: "var(--ws-surface-1)",
    color: "var(--ws-text-primary)",
    border: "1px solid var(--ws-border-medium)",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--ws-surface-3)",
    color: "var(--ws-text-primary)",
    border: "1px solid var(--ws-border-subtle)",
  },
});

export const supersetHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: [tags.keyword, tags.operatorKeyword, tags.modifier],
      color: "var(--brand-violet, #5b4fa8)",
    },
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment],
      color: "var(--ws-text-muted)",
      fontStyle: "italic",
    },
    {
      tag: [tags.string, tags.special(tags.string)],
      color: "var(--brand-teal, #2a6d62)",
    },
    {
      tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null],
      color: "var(--brand-orange, #9e4a2a)",
    },
    {
      tag: [
        tags.function(tags.variableName),
        tags.function(tags.propertyName),
        tags.labelName,
      ],
      color: "var(--ws-accent)",
    },
    {
      tag: [tags.variableName, tags.name, tags.propertyName],
      color: "var(--ws-text-primary)",
    },
    {
      tag: [tags.typeName, tags.definition(tags.typeName)],
      color: "var(--brand-teal, #2a6d62)",
    },
    { tag: [tags.className], color: "var(--brand-orange, #9e4a2a)" },
    {
      tag: [tags.constant(tags.name), tags.standard(tags.name)],
      color: "var(--brand-teal, #2a6d62)",
    },
    {
      tag: [tags.regexp, tags.escape, tags.special(tags.regexp)],
      color: "var(--ws-status-error)",
    },
    {
      tag: [tags.tagName, tags.angleBracket],
      color: "var(--ws-status-error)",
    },
    { tag: [tags.attributeName], color: "var(--brand-violet, #5b4fa8)" },
    { tag: [tags.invalid], color: "var(--ws-status-error)" },
  ]),
);
