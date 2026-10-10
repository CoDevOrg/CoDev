import { gen2PreviewPathSchema } from "@codev/contracts";

/** What the Browser tab's address field opens; a null port keeps the current one. */
export type PreviewAddress = { port: number | null; path: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
const BASE = "http://preview.invalid";

/** A same-origin path, normalized the way a browser would request it. */
function previewPath(rest: string) {
  try {
    const url = new URL(rest || "/", BASE);
    if (url.origin !== BASE) return null;
    const parsed = gen2PreviewPathSchema.safeParse(
      `${url.pathname}${url.search}${url.hash}`,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function withPort(portText: string, rest: string): PreviewAddress | null {
  const port = Number(portText);
  const path = previewPath(rest);
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || !path)
    return null;
  return { port, path };
}

/**
 * Parses what a member types: `3000`, `:3000`, `localhost:3000/x`,
 * `http://127.0.0.1:3000/x?y`, or a bare `/x` on the open port. Anything
 * naming another host is refused; previews only reach the workspace.
 */
export function parsePreviewAddress(input: string): PreviewAddress | null {
  const text = input.trim();
  if (!text || /[\s\\]/.test(text)) return null;
  if (text.startsWith("/")) {
    const path = previewPath(text);
    return path ? { port: null, path } : null;
  }
  const bare = /^:?(\d{1,5})([/?#].*)?$/.exec(text);
  if (bare) return withPort(bare[1]!, bare[2] ?? "");
  const port = /^(?:https?:\/\/)?[^/?#@]*:(\d{1,5})(?:[/?#]|$)/i.exec(text);
  if (!port) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`);
    if (!LOCAL_HOSTS.has(url.hostname) || url.username || url.password)
      return null;
    return withPort(port[1]!, `${url.pathname}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}

/** The address field's text for an opened preview. */
export function formatPreviewAddress(port: number, path: string) {
  return `localhost:${port}${path === "/" ? "" : path}`;
}
