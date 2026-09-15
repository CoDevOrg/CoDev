const { chmodSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const electronBuilderNativeRebuild = require('./scripts/electron-builder-native-rebuild.cjs')
const {
  assertPackagedDaemonEntryExists,
  verifyPackagedDaemonEntryBoots
} = require('./scripts/verify-packaged-daemon-entry.cjs')
const {
  createPackagedRuntimeNodeModuleResources,
  prunePackagedRuntimeNodeModules,
  verifyPackagedMainRuntimeDeps
} = require('./packaged-runtime-node-modules.cjs')
const { verifyLinuxGlibcFloor } = require('./scripts/verify-linux-glibc-floor.cjs')
const { verifyPackagedPluginResources } = require('./scripts/verify-packaged-plugin-resources.cjs')
const { verifySkillsCliRuntime } = require('./scripts/verify-skills-cli-runtime.cjs')

// CoDev ships exactly one artifact from this package: the headless Linux
// `orca serve` AppImage that packages/ide/scripts/build-orca-serve-artifact.sh
// repackages into the per-workspace runtime tarball. The macOS, Windows, deb,
// rpm, code-signing, notarization, and GitHub-publish paths that upstream Orca
// carried here were never exercised by a CoDev build and are gone.
const isLinuxArm64Release = process.env.ORCA_LINUX_ARM64_RELEASE === '1'
const localBuildVersion = process.env.ORCA_LOCAL_BUILD_VERSION
const appId = 'com.stablyai.orca'
// Why: freshness detection needs immutable identity metadata from this exact
// app build, but never needs the skill package bytes or a runtime network read.
const skillFreshnessResources = {
  from: 'resources/skills',
  to: 'skills'
}
// Why: bundled plugins are immutable install inputs and must remain ordinary
// directories so the startup bootstrap can verify and publish exact bytes.
const bundledPluginResources = {
  from: 'resources/plugins/launch',
  to: 'plugins/launch'
}
// Why: the main bundle, packaged CLI, and speech worker all execute
// from package directories where pnpm's symlink farm is absent. Copy the exact
// runtime dependency closure to Resources/node_modules so bare require() calls
// do not fall through to a developer checkout's node_modules.
const commonExtraResources = [bundledPluginResources, skillFreshnessResources]

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId,
  productName: 'Orca',
  ...(localBuildVersion ? { extraMetadata: { version: localBuildVersion } } : {}),
  directories: {
    buildResources: 'resources/build'
  },
  files: [
    '!**/.vscode/*',
    // Why: these repo-only inputs are either bundled into out/ or copied via
    // extraResources. Shipping them in app.asar bloats the bundle.
    '!src{,/**/*}',
    '!config{,/**/*}',
    '!docs{,/**/*}',
    '!native{,/**/*}',
    '!skills{,/**/*}',
    // Why: guide/stub authoring sources are compiled into runtime artifacts; shipping
    // either source tree would duplicate content without a runtime consumer.
    '!skill-guides{,/**/*}',
    '!skill-stubs{,/**/*}',
    '!{AGENTS.md,CLAUDE.md,CODEV-INTEGRATION.md,README.md}',
    '!out/**/*.test.js',
    // Why: Vite's manifest is only used to project the paired web client.
    '!out/renderer/.vite{,/**/*}',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!tsconfig.json',
    '!resources/skills/**',
    // Why: bundled plugins ship via extraResources to resources/plugins/launch;
    // packing the source tree into app.asar would duplicate those exact bytes.
    '!resources/plugins/launch/**'
  ],
  // Why: the CLI entry-point lives in out/cli/ but imports shared modules
  // from out/shared/ and local hook mutators from out/main/. These paths must be
  // unpacked so that Node's require() can resolve the cross-directory imports
  // when the CLI runs outside the asar archive.
  // Why: daemon-entry.js is forked as a separate Node.js process and must be
  // accessible on disk (not inside the asar archive) for child_process.fork().
  // Why: the CLI is compiled by tsc (not bundled), so its runtime imports
  // resolve at runtime via Node's normal module lookup. The shim launches
  // the CLI with ELECTRON_RUN_AS_NODE, which bypasses Electron's asar
  // integration — dependencies inside the asar archive are invisible to
  // require(). Unpack CLI runtime deps so they resolve from
  // app.asar.unpacked/node_modules/.
  // Why: remote runtime connections use WebSocket + E2EE from the packaged CLI
  // before the GUI process starts, so those deps need the same treatment.
  // Why: out/package.json pins compiled output to CommonJS so parent
  // package.json files with type=module cannot change the packaged CLI loader.
  asarUnpack: [
    'out/package.json',
    'out/cli/**',
    'out/shared/**',
    'out/main/agent-hooks/**',
    'out/main/claude/**',
    'out/main/claude-accounts/keychain.js',
    'out/main/codex/**',
    'out/main/daemon-entry.js',
    'out/main/plugin-host-entry.js',
    'out/main/computer-sidecar.js',
    'out/main/parcel-watcher-process-entry.js',
    'out/main/chunks/**',
    'resources/**',
    'node_modules/ws/**',
    'node_modules/tweetnacl/**',
    'node_modules/zod/**',
    'node_modules/yaml/**'
  ],
  afterPack: async (context) => {
    // Why: a Linux runner-image glibc bump silently shipped a node-pty pty.node
    // requiring GLIBC_2.34, crashing the app on startup on Ubuntu 20.04 (#9902).
    // Fail packaging if any bundled native binary exceeds the supported floor.
    verifyLinuxGlibcFloor(context.appOutDir)
    const resourcesDir = join(context.appOutDir, 'resources')
    if (!existsSync(resourcesDir)) {
      throw new Error(`Missing packaged resources directory: ${resourcesDir}`)
    }
    prunePackagedRuntimeNodeModules(resourcesDir, context.electronPlatformName, context.arch)
    verifyPackagedMainRuntimeDeps(resourcesDir)
    // Why: boot the packaged daemon-entry under plain Node, but only for the
    // slice matching the packaging host's arch — daemon-entry.js is JS, yet it
    // require()s the native (N-API) node-pty for the TARGET arch, which the host
    // Node cannot load cross-arch. `Arch` enum: ia32=0, x64=1, armv7l=2,
    // arm64=3, universal=4 (universal contains the host slice, so run it).
    const archEnumByNodeArch = { ia32: 0, x64: 1, armv7l: 2, arm64: 3 }
    const hostArchEnum = archEnumByNodeArch[process.arch]
    const canExecuteTargetArch = context.arch === hostArchEnum || context.arch === 4
    verifySkillsCliRuntime(join(resourcesDir, 'app.asar.unpacked', 'out'), resourcesDir, {
      executeCommands: canExecuteTargetArch
    })
    if (!canExecuteTargetArch) {
      console.log(
        `[verify-skills-cli-runtime] skipped command probes on cross-arch slice (target ${context.arch}, host ${process.arch})`
      )
    }
    if (canExecuteTargetArch) {
      verifyPackagedDaemonEntryBoots(resourcesDir)
    } else {
      // Why: a cross-arch slice can't be booted by the host Node, but the
      // unpacked entry must still exist — its absence is a layout regression
      // regardless of arch, so only the boot is skipped, not the check.
      assertPackagedDaemonEntryExists(resourcesDir)
      console.log(
        `[verify-packaged-daemon-entry] skipped boot on cross-arch slice (target ${context.arch}, host ${process.arch})`
      )
    }
    // Why: inspect electron-builder's real output so a broken extraResources
    // mapping fails packaging before bundled content reaches users.
    verifyPackagedPluginResources(resourcesDir)
    chmodUnixCliLaunchers(resourcesDir)
    for (const filename of readdirSync(resourcesDir)) {
      if (!filename.startsWith('agent-browser-')) {
        continue
      }
      // Why: the upstream package has inconsistent executable bits across
      // platform binaries. child_process.execFile needs the copied binary to be
      // executable in packaged apps.
      chmodSync(join(resourcesDir, filename), 0o755)
    }
  },
  linux: {
    // Why: Ubuntu desktop ships GNOME Orca as the `orca` package and /usr/bin/orca.
    // The Linux installer should not claim those system package/file names.
    executableName: 'codev',
    // Why: the icns source lets electron-builder emit standard hicolor PNG
    // sizes; a single 1024px PNG is ignored by some Linux docks/launchers.
    icon: 'resources/build/icon.icns',
    desktop: {
      entry: {
        // Why: Electron reports WM_CLASS=orca for the visible Linux window;
        // GNOME docks need an exact match to group it with codev.desktop.
        StartupWMClass: 'orca'
      }
    },
    extraResources: [
      ...commonExtraResources,
      ...createPackagedRuntimeNodeModuleResources('linux'),
      {
        from: 'resources/linux/bin/codev',
        to: 'bin/codev'
      },
      {
        from: 'node_modules/agent-browser/bin/agent-browser-linux-${arch}',
        to: 'agent-browser-linux-${arch}'
      },
      {
        from: 'native/computer-use-linux/runtime.py',
        to: 'computer-use-linux/runtime.py'
      }
    ],
    // Why: build-orca-serve-artifact.sh extracts the AppImage's SquashFS and
    // ships that tree; no other package format has a consumer.
    target: ['AppImage'],
    maintainer: 'stablyai',
    category: 'Utility'
  },
  appImage: {
    artifactName: isLinuxArm64Release ? 'orca-linux-arm64.${ext}' : 'orca-linux.${ext}'
  },
  beforeBuild: electronBuilderNativeRebuild,
  // Why: the beforeBuild hook performs Orca's targeted node-pty rebuild for the
  // target arch and returns false so electron-builder does not also rebuild
  // optional cpu-features. npmRebuild must stay true for the hook to run.
  npmRebuild: true,
  // Why: electron-builder auto-publishes under CI when a publish provider is
  // configured. CoDev's orchestrator distributes the artifact itself.
  publish: null
}

function chmodUnixCliLaunchers(resourcesDir) {
  for (const launcherName of ['codev', 'orca', 'orca-ide']) {
    const launcherPath = join(resourcesDir, 'bin', launcherName)
    if (!existsSync(launcherPath)) {
      continue
    }
    // Why: packaged installs expose these extraResources as public shell
    // commands, and source/packager mode drift must not ship a non-executable CLI.
    chmodSync(launcherPath, 0o755)
  }
}
