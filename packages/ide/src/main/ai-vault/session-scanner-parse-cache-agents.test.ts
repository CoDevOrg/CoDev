import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseAgentSessionFile } from './session-scanner-agent-parser'
import {
  CODEX_FIXTURE_SESSION_ID,
  codexFixture,
  codexWorkerFixtureLines
} from './session-scanner-codex-fixtures'
import {
  createSessionParseStats,
  parseAgentSessionFileCached,
  resetSessionParseCacheForTests
} from './session-scanner-parse-cache'
import type { SessionFileCandidate } from './session-scanner-types'

let tempRoots: string[] = []

beforeEach(() => {
  resetSessionParseCacheForTests()
})

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

async function makeTempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-parse-cache-agents-'))
  tempRoots.push(root)
  return root
}

async function candidateFor(
  agent: SessionFileCandidate['agent'],
  path: string,
  codexHome: string | null = null
): Promise<SessionFileCandidate> {
  const fileStat = await stat(path)
  return {
    agent,
    file: {
      path,
      mtimeMs: fileStat.mtimeMs,
      modifiedAt: fileStat.mtime.toISOString(),
      sizeBytes: fileStat.size
    },
    codexHome
  }
}

describe('codex-specific resume behavior', () => {
  it('keeps rejecting worker sessions across incremental appends', async () => {
    const root = await makeTempDir()
    const path = join(root, codexFixture().fileName)
    await writeFile(path, `${codexWorkerFixtureLines().join('\n')}\n`)

    const stats = createSessionParseStats()
    const seeded = await parseAgentSessionFileCached(
      await candidateFor('codex', path),
      process.platform,
      stats
    )
    expect(seeded).toBeNull()

    await appendFile(
      path,
      `${JSON.stringify({
        timestamp: '2026-05-01T10:10:00.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'worker keeps writing' }
      })}\n`
    )
    const grown = await parseAgentSessionFileCached(
      await candidateFor('codex', path),
      process.platform,
      stats
    )
    expect(stats.incremental).toBe(1)
    expect(grown).toBeNull()
  })

  it('picks up a session_index title that appears after the transcript was cached', async () => {
    const root = await makeTempDir()
    const codexHome = join(root, 'codex-home')
    const sessionsDir = join(codexHome, 'sessions', '2026', '05', '01')
    await mkdir(sessionsDir, { recursive: true })
    const fixture = codexFixture()
    const path = join(sessionsDir, fixture.fileName)
    await writeFile(path, `${fixture.seedLines.join('\n')}\n`)

    // No index yet: the title falls back to the first user prompt.
    const seeded = await parseAgentSessionFileCached(
      await candidateFor('codex', path, codexHome),
      process.platform
    )
    expect(seeded?.title).toBe('codex seed question')

    // Codex names the thread lazily; an unchanged transcript must still adopt it.
    await writeFile(
      join(codexHome, 'session_index.jsonl'),
      `${JSON.stringify({ id: CODEX_FIXTURE_SESSION_ID, thread_name: 'Indexed thread title' })}\n`
    )
    const stats = createSessionParseStats()
    const renamed = await parseAgentSessionFileCached(
      await candidateFor('codex', path, codexHome),
      process.platform,
      stats
    )
    expect(stats.reused).toBe(1)
    expect(renamed?.title).toBe('Indexed thread title')
    expect(renamed).toEqual(
      await parseAgentSessionFile(await candidateFor('codex', path, codexHome), process.platform)
    )
  })
})
