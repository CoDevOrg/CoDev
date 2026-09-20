import "server-only";

/**
 * The orchestrator's whole surface, grouped by the resource each call acts
 * on. Callers and `vi.mock` factories target this module, so a call keeps its
 * single import path no matter which file below implements it.
 */

export {
  startClaudeSetupTokenInSandbox,
  submitClaudeSetupTokenCodeInSandbox,
  pollClaudeSetupTokenInSandbox,
  closeClaudeSetupTokenInSandbox,
} from "./orchestrator-claude-auth";
export {
  executeCodexInSandbox,
  startCodexExecInSandbox,
  pollCodexExecInSandbox,
  closeCodexExecInSandbox,
} from "./orchestrator-codex-exec";
export {
  type SandboxExecInput,
  readSandboxFile,
  writeSandboxFile,
  executeInSandbox,
  getSandboxGitOutput,
  listSandboxFiles,
  searchSandboxFiles,
  readSandboxHeadFile,
} from "./orchestrator-files";
export {
  checkOrchestratorConnection,
  checkOrchestratorConnectionAt,
  ensureHostReady,
  waitForOrchestrator,
  waitForOrchestratorAt,
} from "./orchestrator-health";
export {
  type IdeSession,
  type PrepareIdeInput,
  type StartIdeInput,
  prepareIde,
  refreshIdeCredentials,
  startIde,
  getIde,
  touchIde,
  writeIdeFile,
  executeInIde,
  stopIde,
} from "./orchestrator-ide";
export {
  snapshotWorkspace,
  exportSandboxPublication,
} from "./orchestrator-publication";
export { OrchestratorError } from "./orchestrator-request";
export {
  type ProvisionSandboxInput,
  provisionSandbox,
  getSandbox,
  destroySandbox,
  resumeSandbox,
  discardSandboxSnapshot,
  touchSandbox,
} from "./orchestrator-sandbox";
export {
  startSandboxTerminal,
  sendSandboxTerminalInput,
  resizeSandboxTerminal,
  pollSandboxTerminal,
  closeSandboxTerminal,
} from "./orchestrator-terminals";
export {
  type SandboxWorktreeReview,
  type SandboxSessionRestoreFile,
  createSandboxWorktree,
  deleteSandboxWorktree,
  restoreSandboxSession,
  checkpointSandboxWorktree,
  reviewSandboxWorktree,
  rebaseSandboxWorktree,
  mergeSandboxWorktree,
} from "./orchestrator-worktrees";
