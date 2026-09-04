/// <reference types="vite/client" />

import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { OnboardingFeatureSetupDeps } from '@/components/onboarding/onboarding-feature-setup'
import type { languages } from 'monaco-editor'
import type { MonacoE2EProbe } from './components/editor/monaco-e2e-probe'
import type { TerminalWorktreeParkingDebugVerdict } from './components/terminal-pane/terminal-parking-e2e-overrides'

declare module 'monaco-editor/esm/vs/basic-languages/python/python.js' {
  export const conf: languages.LanguageConfiguration
  export const language: languages.IMonarchLanguage
}

// Monaco ships these contributions without public type declarations. We only
// touch the paste-override surface, so declare the minimal shape we use.
declare module 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js' {
  type PasteImplementation = () => boolean | Promise<unknown>
  export const PasteAction:
    | {
        addImplementation: (
          priority: number,
          name: string,
          implementation: PasteImplementation
        ) => { dispose: () => void }
      }
    | undefined
}

declare module 'monaco-editor/esm/vs/editor/browser/controller/editContext/clipboardUtils.js' {
  export const InMemoryClipboardMetadataManager: {
    INSTANCE: {
      get: (pastedText: string) => {
        isFromEmptySelection?: boolean
        multicursorText?: string[] | null
        mode?: string | null
      } | null
    }
  }
}

declare module 'monaco-editor/esm/vs/base/common/async.js' {
  export class Delayer<T = unknown> {
    constructor(defaultDelay: number)
    trigger(task: () => T | Promise<T>, delay?: number): Promise<T | undefined>
    cancel(): void
    dispose(): void
  }
}

declare module 'monaco-editor/esm/vs/base/common/lifecycle.js' {
  type Disposable = {
    dispose(): void
  }

  export class DisposableStore {
    add<T extends Disposable>(disposable: T): T
    clear(): void
    dispose(): void
  }
}

declare global {
  var MonacoEnvironment:
    | {
        getWorker(workerId: string, label: string): Worker
      }
    | undefined
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __CODEV_EMBEDDED__?: boolean
    /** True only while the CoDev shell is mounted ahead of its runtime pairing. */
    __CODEV_PENDING_SHELL__?: boolean
    __CODEV_PROJECT_PATH__?: string
    __CODEV_PROJECT_KIND__?: 'git' | 'folder'
    __CODEV_PROJECT_NAME__?: string
    __CODEV_DEFAULT_AGENT__?: 'claude' | 'codex'
    __CODEV_MEMBER_ID__?: string
    __CODEV_SETTINGS_ONLY__?: boolean
    /** Whether this member has linked a Cursor credential — gates offering
     *  Cursor as a switch target in the in-chat provider picker, since unlike
     *  Claude/Codex it has no host-injected fallback and would otherwise
     *  strand on cursor-agent's own sign-in wall. */
    __CODEV_CURSOR_AVAILABLE__?: boolean
    __paneManagers?: Map<string, PaneManager>
    __onboardingFeatureSetupDeps?: OnboardingFeatureSetupDeps
    __terminalParkingDebug?: {
      parkDelayMs: number
      parkedTabIds: () => string[]
      retentionLimit: number | null
      worktreeVerdicts: () => TerminalWorktreeParkingDebugVerdict[]
    }
    __monacoEditorE2E?: MonacoE2EProbe
    __e2ePtyAppliedSizeReadDelayMs?: number
  }
}

// oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
interface ImportMetaEnv {
  readonly VITE_DIRECT_SSH_RECONNECT_COORDINATOR?: string
  readonly VITE_EXPOSE_STORE?: boolean
}

export {}
