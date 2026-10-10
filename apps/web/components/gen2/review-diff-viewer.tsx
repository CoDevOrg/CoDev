"use client";

import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { parsePatchFiles, type CodeViewItem } from "@pierre/diffs";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";

/**
 * Virtualized git-patch viewer. `@pierre/diffs` 1.3.6 matches vendor/superset
 * and React 19 peers. Worker highlighting is off: Next/webpack is not wired
 * for `@pierre/diffs/worker`. CodeView still virtualizes large patches.
 */
export function ReviewDiffViewer({
  patch,
  layout,
  focusPath,
}: {
  patch: string;
  layout: "unified" | "split";
  /** Scrolls to this file's diff once per `id`, when the patch has it. */
  focusPath?: { path: string; id: number } | null | undefined;
}) {
  const themeType = useWorkspaceThemeType();
  const viewRef = useRef<CodeViewHandle<undefined>>(null);
  const focusedRef = useRef<number | null>(null);
  const parsed = useMemo(() => {
    try {
      return parsePatchFiles(patch, "workspace-review", true);
    } catch {
      return null;
    }
  }, [patch]);

  const items = useMemo<CodeViewItem[]>(() => {
    if (!parsed) return [];
    return parsed.flatMap((entry, patchIndex) =>
      entry.files.map((fileDiff, fileIndex) => ({
        id: `${fileDiff.name}:${patchIndex}:${fileIndex}`,
        type: "diff" as const,
        fileDiff,
      })),
    );
  }, [parsed]);

  const options = useMemo<CodeViewReactOptions>(
    () => ({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType,
      diffStyle: layout,
      overflow: "wrap",
      stickyHeaders: true,
      preferredHighlighter: "shiki-js",
      layout: { paddingTop: 8, paddingBottom: 16, gap: 12 },
      unsafeCSS: `
        :host {
          font-family: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 13px;
          line-height: 20px;
        }
      `,
    }),
    [layout, themeType],
  );

  useEffect(() => {
    if (!focusPath || focusedRef.current === focusPath.id) return;
    const item = items.find(
      (entry) =>
        entry.type === "diff" && entry.fileDiff.name === focusPath.path,
    );
    if (!item) return;
    // After the virtualized view has laid out the patch.
    const frame = requestAnimationFrame(() => {
      focusedRef.current = focusPath.id;
      viewRef.current?.scrollTo({ type: "item", id: item.id, align: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPath, items]);

  if (items.length === 0) {
    return <FallbackPatch patch={patch} />;
  }

  return (
    <DiffErrorBoundary patch={patch}>
      <CodeView
        ref={viewRef}
        items={items}
        options={options}
        disableWorkerPool
        className="gen2-review-diff-view"
        style={{ height: "100%", minHeight: 0 }}
      />
    </DiffErrorBoundary>
  );
}

function useWorkspaceThemeType() {
  const [themeType, setThemeType] = useState<"dark" | "light">(
    readWorkspaceThemeType,
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setThemeType(readWorkspaceThemeType());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
    };
  }, []);

  return themeType;
}

function readWorkspaceThemeType(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

class DiffErrorBoundary extends Component<
  { patch: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <FallbackPatch patch={this.props.patch} />;
    }
    return this.props.children;
  }
}

function FallbackPatch({ patch }: { patch: string }) {
  return (
    <pre className="gen2-superset-diff" aria-label="Working tree diff">
      {patch.split("\n").map((line, index) => (
        <span
          key={index}
          className="gen2-diff-line"
          data-kind={diffLineKind(line)}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

function diffLineKind(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  return "context";
}
