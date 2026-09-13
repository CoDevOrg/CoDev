import { chmodSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function preparePnpmNativeBuild(execPath, platform = process.platform) {
  if (platform === 'win32') {
    return []
  }
  if (!execPath) {
    throw new Error('Run prepare:build-toolchain through pnpm run.')
  }
  const packageRoot = dirname(dirname(realpathSync(execPath)))
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (manifest.name !== 'pnpm') {
    throw new Error('Expected the active pnpm installation.')
  }

  const repaired = []
  // pnpm 10.24.0 ships gyp entrypoints as 0644; make executes them directly.
  for (const name of ['gyp_main.py', 'gyp']) {
    const entry = join(packageRoot, 'dist/node_modules/node-gyp/gyp', name)
    if (!existsSync(entry)) {
      continue
    }
    const mode = statSync(entry).mode
    if ((mode & 0o100) !== 0) {
      continue
    }
    chmodSync(entry, (mode & 0o777) | 0o100)
    repaired.push(name)
  }
  return repaired
}

if (process.argv[1] && realpathSync(import.meta.filename) === realpathSync(process.argv[1])) {
  const repaired = preparePnpmNativeBuild(process.env.npm_execpath)
  console.log(`[build-toolchain] pnpm gyp entrypoints ready (${repaired.length} repaired)`)
}
