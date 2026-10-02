import "server-only";

export {
  startClaudeSetupTokenInSandbox,
  submitClaudeSetupTokenCodeInSandbox,
  pollClaudeSetupTokenInSandbox,
  closeClaudeSetupTokenInSandbox,
} from "./orchestrator-claude-auth";

/**
 * The orchestrator's whole surface, grouped by the resource each call acts
 * on. Callers and `vi.mock` factories target this module, so a call keeps its
 * single import path no matter which file below implements it.
 */

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
export { OrchestratorError } from "./orchestrator-request";
export {
  type ProvisionSandboxInput,
  provisionSandbox,
  getSandbox,
  destroySandbox,
  resumeSandbox,
  discardSandboxSnapshot,
  touchSandbox,
  parkSandbox,
} from "./orchestrator-sandbox";
export {
  startSandboxTerminal,
  sendSandboxTerminalInput,
  resizeSandboxTerminal,
  pollSandboxTerminal,
  closeSandboxTerminal,
} from "./orchestrator-terminals";
