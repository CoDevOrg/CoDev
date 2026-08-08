"use client";

import dynamic from "next/dynamic";

import type { OrcaWorkspaceIdeProps } from "./workspace-ide";

const BrowserOrcaWorkspaceIde = dynamic(
  () => import("./workspace-ide").then((module) => module.OrcaWorkspaceIde),
  {
    ssr: false,
    loading: () => (
      <main aria-label="CoDev Orca IDE">
        <p>Loading Orca workspace…</p>
      </main>
    ),
  },
);

export function OrcaWorkspaceIdeLoader(props: OrcaWorkspaceIdeProps) {
  return <BrowserOrcaWorkspaceIde {...props} />;
}
