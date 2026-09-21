import type {
  NormalizedSessionTranscriptEntry,
  SessionProvider,
} from "@codev/contracts";

import { SessionImportMarkdown } from "./session-import-markdown";
import styles from "./session-import-transcript.module.css";

const LONG_MESSAGE_LENGTH = 2_500;

export function sessionMessagePreview(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return `${compact.length > 280 ? "…" : ""}${compact.slice(-280)}`;
}

function messageLabel(
  entry: NormalizedSessionTranscriptEntry,
  provider: SessionProvider,
) {
  if (entry.authorName) return entry.authorName;
  if (entry.role === "user") return "You";
  if (entry.role === "assistant")
    return provider[0]!.toUpperCase() + provider.slice(1);
  return entry.role.charAt(0).toUpperCase() + entry.role.slice(1);
}

export function SessionImportTranscript({
  entries,
  provider,
}: {
  entries: NormalizedSessionTranscriptEntry[];
  provider: SessionProvider;
}) {
  return (
    <ol className={styles.list} aria-label="Session messages">
      {entries.map((entry) => {
        const isLong = entry.text.length > LONG_MESSAGE_LENGTH;
        const isContextBundle = isLong && entry.role === "user";
        const label = messageLabel(entry, provider);
        return (
          <li
            key={entry.sequence}
            className={`${styles.message} ${entry.role === "user" ? styles.user : styles.other} ${isContextBundle ? styles.context : ""}`}
          >
            <div className={styles.meta}>
              <span className={styles.identity}>
                <span className={styles.avatar} aria-hidden="true">
                  {entry.role === "user" ? "Y" : label.charAt(0)}
                </span>
                <span className={styles.role}>
                  <span>{isContextBundle ? "Imported context" : label}</span>
                  <span className={styles.sequence}>
                    {isContextBundle
                      ? "Source prompt"
                      : `Message ${entry.sequence + 1}`}
                  </span>
                </span>
              </span>
              {entry.createdAt ? (
                <time className={styles.time} dateTime={entry.createdAt}>
                  {new Intl.DateTimeFormat("en", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(entry.createdAt))}
                </time>
              ) : null}
            </div>
            {isLong ? (
              <details className={styles.disclosure}>
                <summary>
                  <span className={styles.disclosureLabel}>
                    {isContextBundle ? "Context bundle" : "Long message"} ·{" "}
                    {entry.text.length.toLocaleString()} characters
                  </span>
                  <span className={styles.preview}>
                    {sessionMessagePreview(entry.text)}
                  </span>
                  <span className={styles.expandHint}>
                    Review source context
                  </span>
                </summary>
                <div className={styles.fullText}>
                  <SessionImportMarkdown text={entry.text} />
                </div>
              </details>
            ) : (
              <SessionImportMarkdown text={entry.text} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export { LONG_MESSAGE_LENGTH };
