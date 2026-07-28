import type { Metadata } from "next";

import { WorkspaceShell } from "@/components/workspace-shell";
import { demoAgents, demoCode, demoFiles, terminalLines } from "@/lib/fixtures";

export const metadata: Metadata = {
  title: "Demo workspace",
  description: "A fixture preview of the CoDev browser workspace.",
};

export default function DemoWorkspacePage() {
  return (
    <WorkspaceShell
      agents={demoAgents}
      code={demoCode}
      files={demoFiles}
      terminalLines={terminalLines}
    />
  );
}
