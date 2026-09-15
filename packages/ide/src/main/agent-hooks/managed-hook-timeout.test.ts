// Why: one regression fixture proves the managed hook timeout budget across every
// managed agent (config entries, wrapper curl flags, and a real dead-endpoint
// shell run) so the cross-agent coverage lives together rather than fragmenting.
import { afterEach, describe,   vi } from 'vitest'
import {  type Server, type Socket } from 'node:net'
import {   rmSync, } from 'node:fs'
import { } from 'node:os'
import { } from 'node:path'
import type { } from 'ssh2'
import type * as osModule from 'node:os'

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/orca-user-data'
  }
}))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof osModule>()
  return {
    ...actual,
    homedir: homedirMock.mockImplementation(actual.homedir)
  }
})

import { } from './installer-utils'
import { } from '../codex/hook-service'
import { } from '../claude/hook-service'

// Each managed agent that ships an SSH-compatible JSON/TOML hook config.

// Why: statusLine is not a hook — Claude's schema has no timeout field (type/command/padding/refreshInterval), and a slow statusline can't block agent turns.

// Walk the parsed config and assert every Orca-managed command carrier (a node
// with a `command`/`bash`/`powershell` string pointing at the managed script
// dir) has a positive config-level timeout sibling (`timeout` or the
// provider-specific `timeoutSec`). Returns the count of managed carriers found
// so callers can assert the scan was not vacuous.

describe('managed agent hook timeouts', () => {

  describe('dead-endpoint transport budget', () => {
    let tempDir: string | null = null
    let server: Server | null = null
    const openSockets: Socket[] = []

    afterEach(() => {
      for (const socket of openSockets.splice(0)) {
        socket.destroy()
      }
      if (server) {
        server.close()
        server = null
      }
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true })
        tempDir = null
      }
    })

    // Why: an accepted-but-unanswered connection is the worst-case hang that only
    // `--max-time` (1.5s) governs — `--connect-timeout` already passes once the
    // TCP handshake completes. Point the wrapper at a real loopback listener that
    // accepts and then stalls, and assert the wrapper still returns well under a
    // generous CI budget.
  })
})
