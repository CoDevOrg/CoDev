/**
 * Static sandbox preview helpers.
 *
 * Live port proxy (`PreviewSource` kind `"live"`) is deferred — see PLAN.md
 * "Browser preview-port forwarding". Do not wire guest networking here.
 *
 * Follow-up: optional `?worktreeId=` so Preview can read an agent worktree
 * before merge (today reads the integration sandbox only).
 */

const PREVIEW_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".json",
  ".txt",
]);

const IGNORED_SEGMENTS = new Set([
  ".git",
  ".next",
  "node_modules",
  "target",
  "dist",
  "coverage",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export const PREVIEW_CSP =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self'";

/** Extension point for later port-forwarded live previews (unused in M2). */
export type PreviewSource =
  | { kind: "static"; entryPath: string; cacheKey: string }
  | { kind: "live"; proxyUrl: string };

export function extensionOf(path: string) {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot).toLowerCase();
}

export function contentTypeForPreviewPath(path: string) {
  return CONTENT_TYPES[extensionOf(path)] ?? "application/octet-stream";
}

export function isPreviewExtensionAllowed(path: string) {
  return PREVIEW_EXTENSIONS.has(extensionOf(path));
}

export function normalizePreviewPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes("\0") || trimmed.includes("\\")) return null;
  if (trimmed.startsWith("/") || trimmed.includes("://")) return null;
  const withoutDotSlash = trimmed.replace(/^\.\/+/, "");
  if (!withoutDotSlash || withoutDotSlash.startsWith("/")) return null;

  const segments = withoutDotSlash
    .split("/")
    .filter((segment) => segment && segment !== ".");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment === ".." || IGNORED_SEGMENTS.has(segment),
    )
  ) {
    return null;
  }

  return segments.join("/");
}

export function assertPreviewPath(raw: string): string {
  const normalized = normalizePreviewPath(raw);
  if (!normalized) {
    throw new Error("Preview path is not allowed.");
  }
  if (!isPreviewExtensionAllowed(normalized)) {
    throw new Error("Preview path extension is not allowed.");
  }
  return normalized;
}

export function resolvePreviewEntry(paths: string[]): string | null {
  const available = new Set(
    paths
      .map((path) => normalizePreviewPath(path))
      .filter((path): path is string => Boolean(path)),
  );

  for (const candidate of [
    "index.html",
    "public/index.html",
    "docs/index.html",
  ]) {
    if (available.has(candidate)) return candidate;
  }

  const rootHtml = [...available]
    .filter(
      (path) =>
        !path.includes("/") &&
        (path.endsWith(".html") || path.endsWith(".htm")),
    )
    .sort((left, right) => left.localeCompare(right));

  return rootHtml[0] ?? null;
}

export function previewDirectoryPrefix(entryPath: string) {
  const slash = entryPath.lastIndexOf("/");
  return slash === -1 ? "" : entryPath.slice(0, slash + 1);
}

export function ensureHtmlBaseHref(html: string, baseHref: string) {
  if (/<base\b/i.test(html)) return html;
  const tag = `<base href="${baseHref}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n${tag}`);
  }
  return `${tag}\n${html}`;
}

export function buildStaticPreviewSource(
  paths: string[],
  cacheKey: string,
): PreviewSource | null {
  const entryPath = resolvePreviewEntry(paths);
  if (!entryPath) return null;
  return { kind: "static", entryPath, cacheKey };
}

export function iframeSrcForPreviewSource(
  workspaceId: string,
  source: PreviewSource,
) {
  if (source.kind === "live") return source.proxyUrl;
  const encoded = source.entryPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/workspaces/${workspaceId}/preview/${encoded}?v=${encodeURIComponent(source.cacheKey)}`;
}
