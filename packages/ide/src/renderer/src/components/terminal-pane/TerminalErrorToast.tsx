import { translate } from '@/i18n/i18n'
const STALE_NODE_PTY_DAEMON_MARKERS = [
  "Daemon's node-pty install is gone",
  'node-pty: posix_spawn failed: ENOENT'
]
const STALE_DAEMON_CWD_MARKERS = [
  "Daemon's working directory is gone",
  'node-pty: daemon_cwd failed: ENOENT'
]
// Thrown by ipc/pty.ts when a persisted pane owner can't be proven alive or dead (STA-3536).
const PANE_OWNER_UNVERIFIED_MARKER = 'terminal_pane_owner_unverified'

export function shouldOfferDaemonRestart(error: string): boolean {
  return [STALE_NODE_PTY_DAEMON_MARKERS, STALE_DAEMON_CWD_MARKERS].some((markers) =>
    markers.every((marker) => error.includes(marker))
  )
}

/** Swaps the raw pane-owner-unverified code for copy a user can act on. */
export function humanizeTerminalError(error: string): string {
  if (!error.includes(PANE_OWNER_UNVERIFIED_MARKER)) {
    return error
  }
  return error.replace(
    PANE_OWNER_UNVERIFIED_MARKER,
    translate(
      'auto.components.terminal.pane.TerminalErrorToast.7ee11bc0db',
      "Orca couldn't confirm whether this terminal's previous session is still running, so it left the session untouched. Reopen this pane to retry."
    )
  )
}

export function TerminalErrorToast({
  error,
  onDismiss,
  onRestartDaemon
}: {
  error: string
  onDismiss: () => void
  onRestartDaemon?: () => void
}): React.JSX.Element {
  const showDaemonRestart = onRestartDaemon && shouldOfferDaemonRestart(error)
  const displayError = humanizeTerminalError(error)

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        right: 12,
        zIndex: 50,
        padding: '10px 14px',
        borderRadius: 6,
        background: 'rgba(220, 38, 38, 0.15)',
        border: '1px solid rgba(220, 38, 38, 0.4)',
        color: '#fca5a5',
        fontSize: 12,
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',
        pointerEvents: 'auto'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <span style={{ minWidth: 0 }}>
          {displayError}
          {showDaemonRestart ? (
            <>
              {'\n'}
              {translate(
                'auto.components.terminal.pane.TerminalErrorToast.cc6d997c65',
                'Restart the terminal daemon from here to clear stale daemon state.'
              )}
            </>
          ) : (
            <>
              {'\n'}
              {translate(
                'auto.components.terminal.pane.TerminalErrorToast.5c8ce20be6',
                'If this persists, please'
              )}{' '}
              <a
                href="https://github.com/stablyai/orca/issues"
                style={{ color: '#fca5a5', textDecoration: 'underline' }}
              >
                {translate(
                  'auto.components.terminal.pane.TerminalErrorToast.a7e2fd2699',
                  'file an issue'
                )}
              </a>
              .
            </>
          )}
        </span>
        {showDaemonRestart ? (
          <button
            onClick={onRestartDaemon}
            style={{
              marginLeft: 12,
              border: '1px solid rgba(252, 165, 165, 0.45)',
              borderRadius: 6,
              background: 'rgba(127, 29, 29, 0.35)',
              color: '#fecaca',
              cursor: 'pointer',
              fontSize: 12,
              padding: '4px 8px',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            {translate(
              'auto.components.terminal.pane.TerminalErrorToast.e4aa243f8c',
              'Restart daemon'
            )}
          </button>
        ) : null}
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: '#fca5a5',
            cursor: 'pointer',
            fontSize: 14,
            padding: '0 0 0 8px',
            lineHeight: 1,
            flexShrink: 0
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
