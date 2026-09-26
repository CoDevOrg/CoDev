"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  FilePlus,
  Folder,
  FolderPlus,
  RefreshCw,
  Search,
} from "lucide-react";

const SupersetCodeEditor = dynamic(
  () =>
    import("./superset-code-editor").then(
      (module) => module.SupersetCodeEditor,
    ),
  {
    ssr: false,
    loading: () => <div className="gen2-superset-code-editor-skeleton" />,
  },
);

const SAMPLE_FILE = {
  path: "src/greeting.ts",
  contents: `export function greeting(name: string) {
  return \`Hello, \${name}!\`;
}

console.log(greeting("CoDev"));
`,
};

/**
 * A narrow browser adaptation of Superset's FilePane. It deliberately starts
 * with one local sample file; the CoDev adapter will replace this input after
 * its authenticated list/read/save/event routes land.
 */
export function SupersetFilePane() {
  const [contents, setContents] = useState(SAMPLE_FILE.contents);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const dirty = contents !== SAMPLE_FILE.contents;

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(SAMPLE_FILE.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setNotice("Couldn’t copy the sample path.");
    }
  }

  return (
    <main className="gen2-superset-file-pane" aria-label="Superset file pane">
      <header className="gen2-superset-tab-strip">
        <div className="gen2-superset-tab" aria-label="Open file: greeting.ts">
          <FileCode2 aria-hidden="true" size={14} />
          <span>greeting.ts</span>
          {dirty ? (
            <span
              className="gen2-superset-dirty"
              aria-label="Unsaved changes"
            />
          ) : null}
        </div>
      </header>
      <aside className="gen2-superset-file-list" aria-label="Files">
        <header className="gen2-superset-files-header">
          <button type="button" className="gen2-superset-search" disabled>
            <Search aria-hidden="true" size={14} />
            <span>Search files</span>
          </button>
          <div
            className="gen2-superset-files-actions"
            aria-label="File actions"
          >
            <SampleAction icon={FilePlus} label="New file" />
            <SampleAction icon={FolderPlus} label="New folder" />
            <SampleAction icon={RefreshCw} label="Refresh files" />
          </div>
        </header>
        <ul role="tree" aria-label="Sample workspace files">
          <li role="none">
            <button
              type="button"
              className="gen2-superset-folder"
              role="treeitem"
              aria-expanded={expanded}
              aria-level={1}
              aria-selected={false}
              onClick={() => setExpanded((current) => !current)}
            >
              <ChevronDown
                aria-hidden="true"
                size={14}
                className={
                  expanded ? undefined : "gen2-superset-chevron-closed"
                }
              />
              <Folder aria-hidden="true" size={15} />
              src
            </button>
            {expanded ? (
              <ul role="group">
                <li role="none">
                  <button
                    type="button"
                    role="treeitem"
                    aria-current="page"
                    aria-level={2}
                    aria-selected={true}
                    className="gen2-superset-file"
                  >
                    <FileCode2 aria-hidden="true" size={15} />
                    greeting.ts
                  </button>
                </li>
              </ul>
            ) : null}
          </li>
        </ul>
      </aside>

      <section className="gen2-superset-editor" aria-label="Code editor">
        <header className="gen2-superset-editor-bar">
          <span className="gen2-superset-path" title={SAMPLE_FILE.path}>
            {SAMPLE_FILE.path}
          </span>
          <div className="gen2-superset-editor-actions">
            <button
              type="button"
              className="gen2-superset-save"
              disabled={!dirty}
              onClick={() =>
                setNotice("Sample mode — the file API is not connected yet.")
              }
            >
              Save
            </button>
            <button
              type="button"
              className="gen2-superset-icon-button"
              onClick={() => void copyPath()}
              aria-label="Copy path"
              title={copied ? "Copied" : "Copy path"}
            >
              {copied ? (
                <Check aria-hidden="true" size={14} />
              ) : (
                <Copy aria-hidden="true" size={14} />
              )}
            </button>
          </div>
        </header>
        {notice ? (
          <p className="gen2-superset-notice" role="status">
            {notice}
          </p>
        ) : null}
        <SupersetCodeEditor
          path={SAMPLE_FILE.path}
          value={contents}
          onChange={(next) => {
            setContents(next);
            setNotice("");
          }}
          onSave={() =>
            setNotice("Sample mode — the file API is not connected yet.")
          }
        />
      </section>
    </main>
  );
}

function SampleAction({
  icon: Icon,
  label,
}: {
  icon: typeof FilePlus;
  label: string;
}) {
  return (
    <button
      type="button"
      className="gen2-superset-icon-button"
      aria-label={label}
      title={`${label} will be available with the file API`}
      disabled
    >
      <Icon aria-hidden="true" size={14} />
    </button>
  );
}
