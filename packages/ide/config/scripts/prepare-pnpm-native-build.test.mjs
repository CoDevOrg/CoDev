import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { preparePnpmNativeBuild } from './prepare-pnpm-native-build.mjs'

test('repairs only active pnpm gyp execution permissions and is idempotent', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'codev-pnpm-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'pnpm' }))
  const executable = join(root, 'bin/pnpm.cjs')
  writeFileSync(executable, '')
  const gyp = join(root, 'dist/node_modules/node-gyp/gyp')
  mkdirSync(gyp, { recursive: true })
  for (const file of ['gyp_main.py', 'gyp', 'other.py']) {
    writeFileSync(join(gyp, file), '', { mode: 0o644 })
  }
  assert.deepEqual(preparePnpmNativeBuild(executable, 'linux'), ['gyp_main.py', 'gyp'])
  assert.equal(statSync(join(gyp, 'gyp_main.py')).mode & 0o777, 0o744)
  assert.equal(statSync(join(gyp, 'other.py')).mode & 0o777, 0o644)
  assert.deepEqual(preparePnpmNativeBuild(executable, 'linux'), [])
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'unrelated' }))
  assert.throws(() => preparePnpmNativeBuild(executable, 'linux'), /active pnpm/)
})

test('requires a pnpm invocation on Unix and does not modify Windows installations', () => {
  assert.throws(() => preparePnpmNativeBuild(undefined, 'linux'), /through pnpm run/)
  assert.deepEqual(preparePnpmNativeBuild(undefined, 'win32'), [])
})
