import type { Extension } from "@codemirror/state";

/**
 * Language modes, loaded on demand.
 *
 * Each arm is a dynamic import so webpack emits one async chunk per language
 * and a workspace of plain text never downloads the Rust grammar. Unknown
 * extensions fall through to no language at all, which CodeMirror renders as
 * plain text rather than failing.
 */
export async function gen2LanguageExtension(
  path: string,
): Promise<Extension | null> {
  switch (path.split(".").at(-1)?.toLowerCase()) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({
        jsx: true,
      });
    case "ts":
      return (await import("@codemirror/lang-javascript")).javascript({
        typescript: true,
      });
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({
        jsx: true,
        typescript: true,
      });
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "md":
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "html":
    case "htm":
      return (await import("@codemirror/lang-html")).html();
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    default:
      return null;
  }
}
