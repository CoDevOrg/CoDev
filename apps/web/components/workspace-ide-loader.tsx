"use client";

import dynamic from "next/dynamic";

import type { WorkspaceIdeProps } from "./workspace-ide-types";

const BrowserWorkspaceIde = dynamic(
  () =>
    import("./theia-workspace-ide").then((module) => module.TheiaWorkspaceIde),
  {
    ssr: false,
    loading: () => (
      <main aria-label="CoDev browser IDE">
        <p>Loading collaborative workspace…</p>
      </main>
    ),
  },
);

export function WorkspaceIdeLoader(props: WorkspaceIdeProps) {
  return <BrowserWorkspaceIde {...props} />;
}
