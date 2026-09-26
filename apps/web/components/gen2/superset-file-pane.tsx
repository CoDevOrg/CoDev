"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { FileCode2, FolderOpen } from "lucide-react";

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
  const dirty = contents !== SAMPLE_FILE.contents;

  return (
    <main className="gen2-superset-file-pane" aria-label="Superset file pane">
      <aside className="gen2-superset-file-list" aria-label="Files">
        <p className="gen2-superset-eyebrow">Explorer</p>
        <ul role="tree" aria-label="Sample workspace files">
          <li role="none">
            <span
              className="gen2-superset-folder"
              role="treeitem"
              aria-expanded="true"
              aria-level={1}
              aria-selected={false}
            >
              <FolderOpen aria-hidden="true" size={15} />
              src
            </span>
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
          </li>
        </ul>
      </aside>

      <section className="gen2-superset-editor" aria-label="Code editor">
        <header className="gen2-superset-editor-bar">
          <span className="gen2-superset-path" title={SAMPLE_FILE.path}>
            {SAMPLE_FILE.path}
            {dirty ? <span aria-label="Unsaved changes">●</span> : null}
          </span>
          <span className="gen2-superset-sample">Sample file</span>
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
