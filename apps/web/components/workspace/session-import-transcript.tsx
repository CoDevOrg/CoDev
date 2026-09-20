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
  return entry.role[0].toUpperCase() + entry.role.slice(1);
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
        return (
          <li
            key={entry.sequence}
            className={`${styles.message} ${entry.role === "user" ? styles.user : styles.other}`}
          >
            <div className={styles.meta}>
              <span className={styles.role}>
                <span className={styles.sequence}>
                  Message {entry.sequence + 1}
                </span>
                {messageLabel(entry, provider)}
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
                    Long source message · {entry.text.length.toLocaleString()}{" "}
                    characters
                  </span>
                  <span className={styles.preview}>
                    {sessionMessagePreview(entry.text)}
                  </span>
                  <span className={styles.expandHint}>Expand full message</span>
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
