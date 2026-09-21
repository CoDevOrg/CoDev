import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * The editor's colours come from the app's own tokens rather than a packaged
 * theme, so the workbench keeps one palette. CodeMirror injects these into a
 * constructed stylesheet and `var()` resolves against `app-theme.css`.
 */
export const gen2EditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "var(--ink)",
      height: "100%",
      fontSize: "13px",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
      lineHeight: "1.6",
    },
    ".cm-content": { caretColor: "var(--gold)" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "color-mix(in srgb, var(--muted) 70%, transparent)",
      border: "none",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--ink) 4%, transparent)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--ink)",
    },
    "&.cm-focused .cm-cursor": { borderLeftColor: "var(--gold)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
      {
        backgroundColor: "color-mix(in srgb, var(--gold) 26%, transparent)",
      },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in srgb, var(--gold) 22%, transparent)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--surface-2)",
      border: "1px solid var(--line)",
      color: "var(--muted)",
    },
  },
  { dark: true },
);

export const gen2Highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: "#f2a35e" },
    { tag: [tags.string, tags.special(tags.string)], color: "#9ad08a" },
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment],
      color: "var(--muted)",
      fontStyle: "italic",
    },
    { tag: [tags.number, tags.bool, tags.null], color: "#d79ef0" },
    {
      tag: [tags.function(tags.variableName), tags.labelName],
      color: "#7fc7f5",
    },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "#e8d27a" },
    { tag: [tags.propertyName, tags.attributeName], color: "#8fd2c8" },
    { tag: [tags.operator, tags.punctuation], color: "var(--muted)" },
    { tag: [tags.heading], color: "var(--gold)", fontWeight: "600" },
    {
      tag: [tags.link, tags.url],
      color: "#7fc7f5",
      textDecoration: "underline",
    },
    { tag: tags.invalid, color: "#f2604a" },
  ]),
);
