"use client";

import { useRef, useState } from "react";
import { Check, Copy, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/platform/utils";

import { parseCanvasBlock } from "./canvas-block";
import styles from "./markdown-content.module.css";

// Styled against the app's semantic --color-* tokens (not hardcoded colors),
// so this renders correctly under any theme that defines them.
export function MarkdownContent({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const canvas = parseCanvasBlock(text);

  return (
    <div className={cn(styles.markdown, className)}>
      {canvas ? (
        <div className={styles.canvas}>
          <div className={styles.canvasHeader}>
            <FileText aria-hidden="true" className={styles.canvasIcon} />
            {canvas.attributes.subject ??
              canvas.variant.charAt(0).toUpperCase() + canvas.variant.slice(1)}
          </div>
          <div className={styles.canvasBody}>
            <MarkdownBody text={canvas.content} />
          </div>
        </div>
      ) : (
        <MarkdownBody text={text} />
      )}
    </div>
  );
}

function CodePre({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);

  const handleCopy = () => {
    if (!preRef.current) return;
    const text = preRef.current.innerText || "";
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.preContainer}>
      <pre ref={preRef}>{children}</pre>
      <button
        type="button"
        onClick={handleCopy}
        className={styles.codeCopyButton}
        title="Copy code"
        aria-label="Copy code"
      >
        {copied ? (
          <Check
            className={cn("size-3.5", styles.codeCopied)}
            aria-hidden="true"
          />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

function MarkdownBody({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ href, children }) {
          if (!href || !/^https?:\/\//i.test(href))
            return <span>{children}</span>;
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
        img({ alt }) {
          // Chat exports can reference remote images. Rendering them would
          // leak a request to whatever host is named in someone else's
          // conversation, so show a placeholder instead.
          return (
            <span className={styles.imagePlaceholder}>
              [Image: {alt || "attachment"}]
            </span>
          );
        },
        table({ children }) {
          return (
            <div className={styles.tableScroll}>
              <table>{children}</table>
            </div>
          );
        },
        pre({ children }) {
          return <CodePre>{children}</CodePre>;
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
