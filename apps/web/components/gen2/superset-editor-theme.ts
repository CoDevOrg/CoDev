import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * Browser-local version of Superset's default Ember editor theme. Keeping the
 * tokens here makes the component visually faithful without importing the
 * desktop theme store or any Electron code into the web bundle.
 */
export const supersetEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--ss-background)",
      color: "var(--ss-foreground)",
      fontFamily: "ui-monospace, Menlo, Consolas, monospace",
      fontSize: "13px",
    },
    ".cm-scroller": { lineHeight: "20px", overflow: "auto" },
    ".cm-content": { padding: "8px 0", caretColor: "var(--ss-foreground)" },
    ".cm-line": { padding: "0 12px" },
    ".cm-gutters": {
      backgroundColor: "var(--ss-background)",
      color: "var(--ss-muted-foreground)",
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
      backgroundColor: "var(--ss-card)",
      border: "1px solid var(--ss-border)",
      borderRadius: "4px",
      color: "var(--ss-muted-foreground)",
      cursor: "pointer",
      margin: "0 2px",
      padding: "0 3px",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--ss-accent) 50%, transparent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor:
          "color-mix(in srgb, var(--ss-highlight) 50%, transparent)",
      },
    ".cm-selectionMatch, .cm-searchMatch": {
      backgroundColor: "var(--ss-highlight-match)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--ss-highlight)",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ss-foreground)" },
    ".cm-panels": {
      backgroundColor: "var(--ss-card)",
      color: "var(--ss-foreground)",
      borderBottom: "1px solid var(--ss-border)",
    },
    ".cm-panels .cm-textfield": {
      backgroundColor: "var(--ss-background)",
      color: "var(--ss-foreground)",
      border: "1px solid var(--ss-input)",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--ss-secondary)",
      color: "var(--ss-secondary-foreground)",
      border: "1px solid var(--ss-border)",
    },
  },
  { dark: true },
);

export const supersetHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: [tags.keyword, tags.operatorKeyword, tags.modifier],
      color: "#d4a84b",
    },
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment],
      color: "#a8a5a3",
      fontStyle: "italic",
    },
    { tag: [tags.string, tags.special(tags.string)], color: "#50a878" },
    {
      tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null],
      color: "#d4a84b",
    },
    {
      tag: [
        tags.function(tags.variableName),
        tags.function(tags.propertyName),
        tags.labelName,
      ],
      color: "#7b9fd4",
    },
    {
      tag: [tags.variableName, tags.name, tags.propertyName],
      color: "#eae8e6",
    },
    { tag: [tags.typeName, tags.definition(tags.typeName)], color: "#77bdb6" },
    { tag: [tags.className], color: "#d4a84b" },
    {
      tag: [tags.constant(tags.name), tags.standard(tags.name)],
      color: "#77bdb6",
    },
    {
      tag: [tags.regexp, tags.escape, tags.special(tags.regexp)],
      color: "#dc6b6b",
    },
    { tag: [tags.tagName, tags.angleBracket], color: "#dc6b6b" },
    { tag: [tags.attributeName], color: "#d4a84b" },
    { tag: [tags.invalid], color: "#ffcccc" },
  ]),
);

/** Superset renders these Lucide-compatible markers rather than text glyphs. */
export function buildSupersetFoldChevron(open: boolean): HTMLElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "cm-foldChevron");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", open ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6");
  svg.appendChild(path);
  return svg as unknown as HTMLElement;
}
