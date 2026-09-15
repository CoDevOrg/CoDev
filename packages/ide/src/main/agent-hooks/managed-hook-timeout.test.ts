// Why: one regression fixture proves the managed hook timeout budget across every
// managed agent (config entries, wrapper curl flags, and a real dead-endpoint
// shell run) so the cross-agent coverage lives together rather than fragmenting.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { CodexHookService } from '../codex/hook-service'
import { } from '../claude/hook-service'

const REMOTE_HOME = '/home/dev'

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

    const hasPosixCurl =
      process.platform !== 'win32' &&
      spawnSync('sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).status === 0

    function runHookScript(scriptPath: string, port: number): Promise<{ status: number | null }> {
      return new Promise((resolve, reject) => {
        const child = spawn('sh', [scriptPath], {
          env: {
            ...process.env,
            ORCA_AGENT_HOOK_ENDPOINT: '',
            ORCA_AGENT_HOOK_PORT: String(port),
            ORCA_AGENT_HOOK_TOKEN: 'test-token',
            ORCA_PANE_KEY: 'pane-1',
            ORCA_TAB_ID: 'tab-1',
            ORCA_WORKTREE_ID: 'wt-1'
          },
          stdio: ['pipe', 'ignore', 'ignore']
        })
        const timeout = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error('hook script exceeded test timeout'))
        }, 10_000)
        child.on('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        child.on('close', (status) => {
          clearTimeout(timeout)
          resolve({ status })
        })
        child.stdin.end('{"hook_event_name":"Stop"}')
      })
    }

    // Why: an accepted-but-unanswered connection is the worst-case hang that only
    // `--max-time` (1.5s) governs — `--connect-timeout` already passes once the
    // TCP handshake completes. Point the wrapper at a real loopback listener that
    // accepts and then stalls, and assert the wrapper still returns well under a
    // generous CI budget.
    it.skipIf(!hasPosixCurl)(
      'returns within budget when the local listener accepts but never responds',
      async () => {
        // Reuse a real generated POSIX wrapper rather than re-deriving the script.
        const { sftp, fs } = createFakeSftp()
        await new CodexHookService().installRemote(sftp, REMOTE_HOME)
        const wrapperBody = fs.files.get(`${REMOTE_HOME}/.codev/agent-hooks/codex-hook.sh`)!

        tempDir = mkdtempSync(join(tmpdir(), 'orca-hook-timeout-'))
        const scriptPath = join(tempDir, 'codex-hook.sh')
        writeFileSync(scriptPath, wrapperBody, 'utf8')
        chmodSync(scriptPath, 0o755)

        const stallingServer = createServer((socket) => {
          // Accept the connection and hold it open without ever replying.
          openSockets.push(socket)
        })
        server = stallingServer
        const port = await new Promise<number>((resolve) => {
          stallingServer.listen(0, '127.0.0.1', () => {
            const address = stallingServer.address()
            resolve(typeof address === 'object' && address ? address.port : 0)
          })
        })

        const startedAt = Date.now()
        const result = await runHookScript(scriptPath, port)
        const elapsedMs = Date.now() - startedAt

        // The hook fails open (`|| true`) and exits 0 even though the POST timed out.
        expect(result.status).toBe(0)
        expect(openSockets.length).toBeGreaterThan(0)
        expect(elapsedMs).toBeGreaterThanOrEqual(1_000)
        // --max-time 1.5s + process overhead; a hang would blow well past this.
        expect(elapsedMs).toBeLessThan(6_000)
      }
    )
  })
})
