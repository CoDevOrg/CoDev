"use client";

import dynamic from "next/dynamic";

import type { WorkspaceIdeProps } from "./workspace-ide";

const BrowserWorkspaceIde = dynamic(
  () => import("./workspace-ide").then((module) => module.WorkspaceIde),
  {
    ssr: false,
    loading: () => (
      <main aria-label="CoDev browser IDE">
        <p>Loading browser IDE…</p>
      </main>
    ),
  },
);

export function WorkspaceIdeLoader(props: WorkspaceIdeProps) {
  return <BrowserWorkspaceIde {...props} />;
}
