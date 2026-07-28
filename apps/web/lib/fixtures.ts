export const demoFiles = [
  { name: "apps", kind: "folder", depth: 0 },
  { name: "web", kind: "folder", depth: 1 },
  { name: "components", kind: "folder", depth: 2 },
  { name: "workspace-shell.tsx", kind: "tsx", depth: 3, active: true },
  { name: "activity-panel.tsx", kind: "tsx", depth: 3 },
  { name: "app", kind: "folder", depth: 2 },
  { name: "globals.css", kind: "css", depth: 3 },
  { name: "packages", kind: "folder", depth: 0 },
  { name: "contracts", kind: "folder", depth: 1 },
  { name: "README.md", kind: "markdown", depth: 0 },
] as const;

export const demoCode = [
  {
    number: 1,
    content: 'import type { AgentSession } from "@codev/contracts";',
  },
  { number: 2, content: "" },
  { number: 3, content: "type WorkspaceShellProps = {" },
  { number: 4, content: "  workspace: Workspace;" },
  { number: 5, content: "  sessions: AgentSession[];" },
  { number: 6, content: "};" },
  { number: 7, content: "" },
  { number: 8, content: "export function WorkspaceShell({" },
  { number: 9, content: "  workspace," },
  { number: 10, content: "  sessions," },
  { number: 11, content: "}: WorkspaceShellProps) {" },
  { number: 12, content: "  return (" },
  { number: 13, content: "    <main data-workspace={workspace.id}>" },
  { number: 14, content: "      <AgentActivity sessions={sessions} />" },
  { number: 15, content: "    </main>" },
  { number: 16, content: "  );" },
  { number: 17, content: "}" },
] as const;

export const demoAgents = [
  {
    initials: "AT",
    name: "Atlas",
    task: "Build workspace shell",
    branch: "agent/atlas-shell",
    state: "Working",
    tone: "teal",
  },
  {
    initials: "NV",
    name: "Nova",
    task: "Define event contracts",
    branch: "agent/nova-contracts",
    state: "Review",
    tone: "violet",
  },
] as const;

export const terminalLines = [
  { prompt: true, text: "pnpm test" },
  { text: "✓ packages/contracts  8 tests passed", kind: "success" },
  { text: "✓ apps/web           4 tests passed", kind: "success" },
  { text: "Test Files  2 passed (2)", kind: "muted" },
] as const;
