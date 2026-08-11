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

const localHelloContents =
  'export function hello() {\n  return "hello from Alex";\n}';
const terminalHelloContents =
  'export function hello() {\n  return "hello from terminal";\n}';

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
  const [jordanActiveFile, setJordanActiveFile] = useState("src/hello.ts");
  const [jordanSelection, setJordanSelection] = useState<
    typeof helloFunctionSelection | null
  >(null);
  const [jordanConnected, setJordanConnected] = useState(true);
  const [replayStatus, setReplayStatus] = useState<string | null>(null);
  const [collaborativeHelloContents, setCollaborativeHelloContents] = useState(
    filePreviews["src/hello.ts"] ?? "",
  );
  const [externalHelloContents, setExternalHelloContents] = useState<
    string | null
  >(null);

  const selectFile = (file: string) => {
    setActiveFile(file);
    setSelection(null);
    setReplayStatus(null);
    if (jordanConnected) {
      setJordanActiveFile(file);
      setJordanSelection(null);
    }
  };
  const selectHelloFunction = () => {
    setSelection(helloFunctionSelection);
    if (jordanConnected) setJordanSelection(helloFunctionSelection);
  };
  const editHelloFunction = () => {
    setCollaborativeHelloContents(localHelloContents);
    setSelection(helloFunctionSelection);
    if (jordanConnected) setJordanSelection(helloFunctionSelection);
    setReplayStatus(null);
  };
  const simulateExternalChange = () => {
    setExternalHelloContents(terminalHelloContents);
    setReplayStatus(
      "Conflict detected. The shared editor and terminal versions are both preserved.",
    );
  };
  const disconnectJordan = () => {
    setJordanConnected(false);
    setReplayStatus(
      "Jordan disconnected. Presence and document replay are waiting for reconnect.",
    );
  };
  const reconnectJordan = () => {
    setJordanConnected(true);
    setJordanActiveFile(activeFile);
    setJordanSelection(selection);
    setReplayStatus(
      `Jordan reconnected. Presence and document state replayed for ${activeFile}.`,
    );
  };
  const previewContents =
    jordanActiveFile === "src/hello.ts"
      ? collaborativeHelloContents
      : (filePreviews[jordanActiveFile] ?? "");
  const previewLines = previewContents.split("\n");
  const conflictActive =
    activeFile === "src/hello.ts" && externalHelloContents !== null;

  return (
    <section
      className={`${styles.card} ${styles.sharedIde}`}
      aria-labelledby="shared-ide-heading"
    >
      <div className={styles.cardHeading}>
        <div>
          <span className={styles.kicker}>F2.5 · IDE conflict</span>
          <h2 id="shared-ide-heading">Live shared IDE views</h2>
        </div>
        <span className={styles.count}>
          {jordanConnected ? "Live" : "Offline"}
        </span>
      </div>

      <p className={styles.presenceIntro}>
        Alex changes files and selects text while Jordan reconnects and
        resubscribes to the latest presence and document state.
      </p>

      <div className={styles.idePresence} aria-label="IDE presence">
        <div aria-label="Alex Morgan IDE presence">
          <span className={styles.presenceDot} aria-hidden="true" />
          <strong>Alex Morgan</strong>
          <span>present · editing</span>
        </div>
        <div
          aria-label="Jordan Lee IDE presence"
          className={!jordanConnected ? styles.presencePending : undefined}
        >
          <span className={styles.presenceDot} aria-hidden="true" />
          <strong>Jordan Lee</strong>
          <span>
            {jordanConnected ? "present · observing" : "offline · reconnecting"}
          </span>
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
              onClick={selectHelloFunction}
              type="button"
            >
              Select hello function as Alex
            </button>
            <button
              className={styles.ideEditButton}
              disabled={activeFile !== "src/hello.ts"}
              onClick={editHelloFunction}
              type="button"
            >
              Edit hello function as Alex
            </button>
            <button
              className={styles.ideExternalChangeButton}
              disabled={
                activeFile !== "src/hello.ts" ||
                collaborativeHelloContents === filePreviews["src/hello.ts"]
              }
              onClick={simulateExternalChange}
              type="button"
            >
              Simulate terminal change
            </button>
            <button
              className={styles.ideReconnectButton}
              onClick={jordanConnected ? disconnectJordan : reconnectJordan}
              type="button"
            >
              {jordanConnected ? "Disconnect Jordan" : "Reconnect Jordan"}
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
            <span
              className={
                jordanConnected
                  ? styles.presenceDot
                  : `${styles.presenceDot} ${styles.presencePending}`
              }
              aria-hidden="true"
            />
            <span>
              {jordanConnected ? (
                <>
                  <strong>Alex Morgan</strong> is viewing{" "}
                  <code>{jordanActiveFile}</code>
                </>
              ) : (
                <>
                  Jordan is reconnecting from <code>{jordanActiveFile}</code>
                </>
              )}
            </span>
          </div>
          {jordanSelection ? (
            <div
              className={styles.ideSelectionMarker}
              aria-label="Jordan Lee remote selection"
              role="status"
            >
              <span className={styles.selectionSwatch} aria-hidden="true" />
              <span>
                <strong>Alex Morgan</strong> selected {jordanSelection.label} ·
                lines {jordanSelection.startLine + 1}–
                {jordanSelection.endLine + 1}
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
          {conflictActive ? (
            <section
              className={styles.ideConflict}
              aria-label="External file change conflict"
            >
              <div className={styles.ideConflictHeader}>
                <div>
                  <span className={styles.label}>External file change</span>
                  <strong>Resolve before syncing either version</strong>
                </div>
                <span className={styles.ideConflictBadge}>Conflict</span>
              </div>
              <p>
                Alex&apos;s shared editor and the terminal changed this file
                independently. No version was overwritten.
              </p>
              <div className={styles.ideConflictVersions}>
                <div>
                  <span className={styles.label}>Collaborative editor</span>
                  <pre aria-label="Collaborative editor version">
                    {collaborativeHelloContents}
                  </pre>
                </div>
                <div>
                  <span className={styles.label}>External filesystem</span>
                  <pre aria-label="External filesystem version">
                    {externalHelloContents}
                  </pre>
                </div>
              </div>
              <div
                className={styles.ideConflictChoices}
                aria-label="Conflict resolution choices"
              >
                <span className={styles.label}>Resolution choices</span>
                <div>
                  <span>Keep collaborative editor</span>
                  <span>Use external filesystem</span>
                  <span>Merge manually</span>
                </div>
              </div>
            </section>
          ) : null}
          <p className={styles.ideSyncNote}>
            Jordan&apos;s editor content stays synchronized separately from
            presence updates.
          </p>
        </div>
      </div>

      {replayStatus ? (
        <p
          className={styles.ideReplayStatus}
          aria-label="Jordan reconnect state"
          role="status"
        >
          {replayStatus}
        </p>
      ) : null}
      <p className={styles.viewerStatus} role="status">
        {conflictActive ? (
          <>
            Conflict waiting for a resolution; both versions remain available
            for review.
          </>
        ) : jordanConnected ? (
          <>
            Jordan sees Alex Morgan viewing <code>{jordanActiveFile}</code>
            {jordanSelection
              ? ` with the ${jordanSelection.label} selected.`
              : "."}
          </>
        ) : (
          <>
            Jordan is reconnecting; the last synced document is{" "}
            <code>{jordanActiveFile}</code>.
          </>
        )}
      </p>
    </section>
  );
}
