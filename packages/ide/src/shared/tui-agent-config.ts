import type { TuiAgent } from './types'
import {
  getLegacyOrcaCliCommandNamesForPlatform,
  getOrcaCliCommandNameForPlatform
} from './orca-cli-command-name'

export type AgentPromptInjectionMode = 'argv' | 'stdin-after-start'

export type DraftPasteReadySignal = 'render-quiet-after-bracketed-paste' | 'codex-composer-prompt'

export type TuiAgentDetectionRuntime = NodeJS.Platform | 'wsl'

export type TuiAgentConfig = {
  detectCmd: string
  /** Additional executable names that identify the same agent on PATH. */
  detectCmdAliases?: readonly string[]
  /** Other commands that must also be present before this agent counts as installed. */
  detectRequiredCommands?: readonly string[]
  /** Detection runtimes where this launch mode is not available as a detected agent. */
  detectUnsupportedRuntimes?: readonly TuiAgentDetectionRuntime[]
  launchCmd: string
  /** Platform-specific launch command when the public binary name differs. */
  launchCmdByPlatform?: Partial<Record<NodeJS.Platform, string>>
  /** Overrides for launches on a remote host, which may run a differently-named shim. */
  remoteLaunchCmdByPlatform?: Partial<Record<NodeJS.Platform, string>>
  expectedProcess: string
  promptInjectionMode: AgentPromptInjectionMode
  /** Option terminator required before positional prompts that may look like CLI syntax. */
  argvPromptSeparator?: '--'
  /** Native CLI flag that seeds the input without submitting (e.g. Claude's `--prefill <text>`); preferred over the paste-after-ready path. */
  draftPromptFlag?: string
  /** Startup env var that seeds the input without submitting, for agents with no `--prefill`-style flag (e.g. pi); avoids the paste-after-ready race. */
  draftPromptEnvVar?: string
  /** Pre-write a trust artifact so the agent's first-launch "trust this folder?" menu doesn't consume the bracketed paste (see agent-trust-presets.ts). */
  preflightTrust?: 'claude' | 'codex'
  /** Renderer-specific signal that the composer is ready for paste, stronger than the default quiet-render window. */
  draftPasteReadySignal?: DraftPasteReadySignal
  /** Windows Shift+Enter encoding override; omitted agents keep the legacy Esc+CR path. */
  windowsShiftEnterEncoding?: 'csi-u'
}

export const TUI_AGENT_CONFIG: Record<TuiAgent, TuiAgentConfig> = {
  claude: {
    detectCmd: 'claude',
    launchCmd: 'claude',
    expectedProcess: 'claude',
    promptInjectionMode: 'argv',
    // Why: `claude --prefill <text>` seeds the input without submitting, avoiding the paste-after-ready race (PR https://github.com/stablyai/orca/pull/926).
    draftPromptFlag: '--prefill',
    // Why: a fresh agent worktree otherwise opens on "trust this folder?", which swallows the first chat message.
    preflightTrust: 'claude'
  },
  'claude-agent-teams': {
    // Why: an Orca-provided launch mode, not a separate binary; detection follows the Orca CLI.
    detectCmd: 'orca',
    // Detection, not naming: keep the pre-rename aliases so a session started
    // by an older build is still recognised.
    detectCmdAliases: ['codev', 'codev-dev', 'orca-dev', 'orca-ide'],
    // Why: require Claude too so fresh installs (Orca shim always present) don't report Agent Teams without an agent CLI.
    detectRequiredCommands: ['claude'],
    // Why: Windows/WSL use Claude's in-process Agent Teams fallback, not this Orca native-pane/tmux-shim wrapper.
    detectUnsupportedRuntimes: ['win32', 'wsl'],
    launchCmd: 'orca claude-teams',
    launchCmdByPlatform: {
      darwin: `${getOrcaCliCommandNameForPlatform('darwin')} claude-teams`,
      linux: `${getOrcaCliCommandNameForPlatform('linux')} claude-teams`,
      win32: `${getOrcaCliCommandNameForPlatform('win32')} claude-teams`
    },
    // Why: the relay deploys the shim under its pre-rename name, so a remote
    // launch must not use the local `codev` command.
    remoteLaunchCmdByPlatform: {
      win32: `${getLegacyOrcaCliCommandNamesForPlatform('win32')[0]} claude-teams`
    },
    expectedProcess: 'claude',
    promptInjectionMode: 'stdin-after-start'
  },
  codex: {
    detectCmd: 'codex',
    launchCmd: 'codex',
    expectedProcess: 'codex',
    promptInjectionMode: 'argv',
    preflightTrust: 'codex',
    draftPasteReadySignal: 'codex-composer-prompt'
  }
}

export function isTuiAgent(value: unknown): value is TuiAgent {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TUI_AGENT_CONFIG, value)
}

export function getTuiAgentDetectCommands(config: TuiAgentConfig): string[] {
  return [config.detectCmd, ...(config.detectCmdAliases ?? [])]
}

export function getTuiAgentLaunchCommand(
  config: TuiAgentConfig,
  platform: NodeJS.Platform,
  opts?: { isRemote?: boolean }
): string {
  // Why: the local `codev` rename must not leak to remotes, whose relay shim
  // still carries the pre-rename name.
  if (opts?.isRemote) {
    return config.remoteLaunchCmdByPlatform?.[platform] ?? config.launchCmd
  }
  return config.launchCmdByPlatform?.[platform] ?? config.launchCmd
}
