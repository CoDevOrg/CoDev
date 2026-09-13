import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'dist/squashfs-root')
const binary = join(root, 'codev')
assert.ok(existsSync(binary), 'Packaged CoDev executable must exist')
const scratch = mkdtempSync(join(tmpdir(), 'codev-artifact-'))
const started = performance.now()

async function runPtyCheck() {
  const modulePath = join(root, 'resources/node_modules/node-pty')
  const source = `
    const pty = require(${JSON.stringify(modulePath)});
    const terminal = pty.spawn('/bin/sh', ['-c', 'read value; test "$value" = codev-input && printf codev-pty-ok'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: ${JSON.stringify(scratch)}, env: process.env });
    let output = '';
    terminal.onData(data => output += data);
    terminal.onExit(({exitCode}) => { if (exitCode !== 0 || !output.includes('codev-pty-ok')) process.exit(1); console.log('PTY input/output passed'); });
    terminal.write('codev-input\\r');
    setTimeout(() => process.exit(2), 10000).unref();
  `
  await new Promise((accept, reject) => {
    const child = spawn(binary, ['-e', source], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('PTY smoke timed out'))
    }, 15000)
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        accept()
      } else {
        reject(new Error(`Packaged PTY smoke failed (${code})`))
      }
    })
  })
}

async function runServerCheck() {
  await new Promise((accept, reject) => {
    const child = spawn(
      join(root, 'AppRun'),
      [
        '--serve',
        '--serve-port',
        '39173',
        '--serve-pairing-address',
        'http://127.0.0.1:39173',
        '--serve-project-root',
        scratch,
        '--serve-json'
      ],
      { env: { ...process.env, HOME: scratch }, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let buffered = ''
    let settled = false
    const finish = (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      child.kill('SIGTERM')
      if (error) {
        reject(error)
      } else {
        accept()
      }
    }
    const timeout = setTimeout(
      () => finish(new Error('Packaged server readiness timed out')),
      30000
    )
    child.on('error', finish)
    child.on('exit', (code) =>
      finish(new Error(`Packaged server exited before readiness (${code})`))
    )
    const observe = (data) => {
      buffered += data.toString()
      let end
      while ((end = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, end)
        buffered = buffered.slice(end + 1)
        try {
          const event = JSON.parse(line)
          if (event.type === 'orca_server_ready' && event.pairing?.available === true) {
            finish()
          }
        } catch {
          /* Non-JSON startup diagnostics are not readiness. */
        }
      }
    }
    child.stdout.on('data', observe)
    child.stderr.on('data', observe)
  })
}

try {
  await runPtyCheck()
  await runServerCheck()
  console.log(
    JSON.stringify({
      artifact: 'codev-workspace-runtime',
      ptyInputOutput: 'passed',
      serverReadiness: 'passed',
      durationMs: Math.round(performance.now() - started)
    })
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
