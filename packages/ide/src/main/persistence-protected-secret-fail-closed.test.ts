import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

type FailureMode = 'availability-throws' | 'encryption-throws' | 'unavailable'

const testState = { dir: '' }
const cipherState = {
  availability: 'available' as 'available' | 'throws' | 'unavailable',
  encryptionThrows: false,
  decryptionThrows: false
}

vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: vi.fn(),
  sshConfigHostsToTargets: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => {
      if (cipherState.availability === 'throws') {
        throw new Error('keychain access denied')
      }
      return cipherState.availability === 'available'
    },
    encryptString: (plaintext: string) => {
      if (cipherState.encryptionThrows) {
        throw new Error('keychain encryption failed')
      }
      return Buffer.from(`enc:${randomUUID()}:${plaintext}`, 'utf-8')
    },
    decryptString: (ciphertext: Buffer) => {
      if (cipherState.decryptionThrows) {
        throw new Error('keychain decryption failed')
      }
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('enc:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('enc:'.length + 36 + 1)
    }
  }
}))

vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn().mockReturnValue({ nth_repo_added: 2 })
}))

async function createStore() {
  vi.resetModules()
  const { Store, initDataPath } = await import('./persistence')
  initDataPath()
  return new Store()
}

function dataFile(): string {
  return join(testState.dir, 'orca-data.json')
}

type ProtectedState = {
  settings: {
    httpProxyUrl: string
    httpProxyBypassRules: string
  }
  ui: { browserKagiSessionLink: string | null }
  sshPtyConsumerRecoveries: { ownerLease: string }[]
}

function readState(path = dataFile()): ProtectedState {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

const ORIGINAL = {
  proxy: 'http://old-user:old-pass@proxy.test:8080',
  kagi: 'https://kagi.test/session/old-token'
} as const
const PENDING = {
  proxy: 'http://new-user:new-pass@proxy.test:8080',
  kagi: 'https://kagi.test/session/new-token'
} as const

function setFailure(mode: FailureMode): void {
  cipherState.availability =
    mode === 'availability-throws' ? 'throws' : mode === 'unavailable' ? 'unavailable' : 'available'
  cipherState.encryptionThrows = mode === 'encryption-throws'
}

async function writeProtectedState(
  store: Awaited<ReturnType<typeof createStore>>,
  values: typeof ORIGINAL | typeof PENDING,
  bypassRules: string
): Promise<void> {
  store.updateSettings({
    httpProxyUrl: values.proxy,
    httpProxyBypassRules: bypassRules
  })
  store.updateUI({ browserKagiSessionLink: values.kagi })
  vi.advanceTimersByTime(2_000)
  await store.waitForPendingWrite()
}

function expectPlaintextsAbsent(raw: string, values: typeof ORIGINAL | typeof PENDING): void {
  for (const plaintext of Object.values(values)) {
    expect.soft(raw).not.toContain(plaintext)
  }
}

async function settleSave(store: Awaited<ReturnType<typeof createStore>>): Promise<void> {
  vi.advanceTimersByTime(2_000)
  await store.waitForPendingWrite()
}

describe('protected persistence when safeStorage fails', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-safe-storage-test-'))
    cipherState.availability = 'available'
    cipherState.encryptionThrows = false
    cipherState.decryptionThrows = false
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it.each<FailureMode>(['availability-throws', 'encryption-throws', 'unavailable'])(
    'omits newly introduced protected values during a persistent failure: %s',
    async (failureMode) => {
      setFailure(failureMode)
      const store = await createStore()
      await writeProtectedState(store, PENDING, 'non-secret-saved')

      const raw = readFileSync(dataFile(), 'utf-8')
      const persisted = readState()
      expectPlaintextsAbsent(raw, PENDING)
      expect(persisted.settings.httpProxyUrl).toBe('')
      expect(persisted.ui.browserKagiSessionLink).toBe('')
      expect(persisted.settings.httpProxyBypassRules).toBe('non-secret-saved')
    }
  )

  it('persists clears after a healthy save preserves sealed ciphertext', async () => {
    const initial = await createStore()
    await writeProtectedState(initial, ORIGINAL, 'before')
    const originalCiphertext = readState()

    cipherState.availability = 'unavailable'
    const sealed = await createStore()
    expect(sealed.getSettings().httpProxyUrl).toBe('')

    cipherState.availability = 'available'
    sealed.updateSettings({ httpProxyBypassRules: 'healthy-preserve' })
    await settleSave(sealed)
    expect(readState().settings.httpProxyUrl).toBe(originalCiphertext.settings.httpProxyUrl)

    sealed.updateSettings({ httpProxyUrl: '' })
    await settleSave(sealed)
    expect(readState().settings.httpProxyUrl).toBe('')
  })

})
