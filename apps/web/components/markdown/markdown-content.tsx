import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/platform/utils";

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
  return (
    <div className={cn(styles.markdown, className)}>
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
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
