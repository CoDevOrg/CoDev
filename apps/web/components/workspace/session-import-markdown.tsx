import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import styles from "./session-import-markdown.module.css";

export function SessionImportMarkdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
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
            // A rollout can contain remote images. Keep the review private by
            // avoiding requests to hosts named in imported content.
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
