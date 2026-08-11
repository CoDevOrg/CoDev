"use client";

import { useState } from "react";

import { verificationFixture } from "@/lib/verification-fixture";

import styles from "@/app/verification/b0-2/fixture.module.css";

const filePreviews: Record<string, string> = {
  "README.md":
    "# CoDev fixture\n\nA shared workspace for browser verification.",
  "src/hello.ts": 'export function hello() {\n  return "hello";\n}',
  "tests/hello.test.ts": 'expect(hello()).toBe("hello");',
};

const helloFunctionSelection = {
  endLine: 2,
  label: "hello function",
  startLine: 0,
};

export function SharedIdePresenceFixture() {
  const [activeFile, setActiveFile] = useState("src/hello.ts");
  const [selection, setSelection] = useState<
    typeof helloFunctionSelection | null
  >(null);

  const selectFile = (file: string) => {
    setActiveFile(file);
    setSelection(null);
  };
  const previewLines = (filePreviews[activeFile] ?? "").split("\n");

  return (
    <section
      className={`${styles.card} ${styles.sharedIde}`}
      aria-labelledby="shared-ide-heading"
    >
      <div className={styles.cardHeading}>
        <div>
          <span className={styles.kicker}>F2.2 · IDE presence</span>
          <h2 id="shared-ide-heading">Live shared IDE views</h2>
        </div>
        <span className={styles.count}>Live</span>
      </div>

      <p className={styles.presenceIntro}>
        Alex changes files and selects text in the editor while Jordan sees the
        named active-file and selection state update in the shared IDE.
      </p>

      <div className={styles.idePresence} aria-label="IDE presence">
        <div aria-label="Alex Morgan IDE presence">
          <span className={styles.presenceDot} aria-hidden="true" />
          <strong>Alex Morgan</strong>
          <span>present · editing</span>
        </div>
        <div aria-label="Jordan Lee IDE presence">
          <span className={styles.presenceDot} aria-hidden="true" />
          <strong>Jordan Lee</strong>
          <span>present · observing</span>
        </div>
      </div>

      <div className={styles.ideSurface}>
        <aside
          className={styles.ideFileNav}
          aria-label="Alex Morgan file navigator"
        >
          <span className={styles.label}>Alex Morgan · files</span>
          <div>
            {verificationFixture.files.map((file) => (
              <button
                aria-pressed={activeFile === file}
                className={
                  activeFile === file
                    ? styles.ideFileActive
                    : styles.ideFileButton
                }
                key={file}
                onClick={() => selectFile(file)}
                type="button"
              >
                <span aria-hidden="true">·</span>
                {file}
              </button>
            ))}
            <button
              className={styles.ideSelectionButton}
              disabled={activeFile !== "src/hello.ts"}
              onClick={() => setSelection(helloFunctionSelection)}
              type="button"
            >
              Select hello function as Alex
            </button>
          </div>
        </aside>

        <div
          className={styles.ideEditor}
          aria-label="Jordan Lee remote IDE view"
        >
          <div className={styles.ideEditorHeader}>
            <span className={styles.label}>Jordan Lee · shared view</span>
            <code>{activeFile}</code>
          </div>
          <div
            className={styles.ideRemotePresence}
            aria-label="Jordan Lee active-file observation"
            role="status"
          >
            <span className={styles.presenceDot} aria-hidden="true" />
            <span>
              <strong>Alex Morgan</strong> is viewing <code>{activeFile}</code>
            </span>
          </div>
          {selection ? (
            <div
              className={styles.ideSelectionMarker}
              aria-label="Jordan Lee remote selection"
              role="status"
            >
              <span className={styles.selectionSwatch} aria-hidden="true" />
              <span>
                <strong>Alex Morgan</strong> selected {selection.label} · lines{" "}
                {selection.startLine + 1}–{selection.endLine + 1}
              </span>
            </div>
          ) : (
            <div
              className={styles.ideSelectionEmpty}
              aria-label="Jordan Lee remote selection"
              role="status"
            >
              No remote text selected
            </div>
          )}
          <pre className={styles.ideCode} aria-label="Shared editor content">
            <code>
              {previewLines.map((line, index) => (
                <span
                  className={
                    selection &&
                    index >= selection.startLine &&
                    index <= selection.endLine
                      ? styles.ideSelectedLine
                      : styles.ideCodeLine
                  }
                  key={`${activeFile}-${index}`}
                >
                  {line || " "}
                  {index < previewLines.length - 1 ? "\n" : null}
                </span>
              ))}
            </code>
          </pre>
          <p className={styles.ideSyncNote}>
            Jordan’s editor content stays synchronized separately from presence
            updates.
          </p>
        </div>
      </div>

      <p className={styles.viewerStatus} role="status">
        Jordan sees Alex Morgan viewing <code>{activeFile}</code>
        {selection ? ` with the ${selection.label} selected.` : "."}
      </p>
    </section>
  );
}
