/* eslint-disable max-lines -- Why: one module keeps native (@parcel/watcher) and WSL-snapshot watcher lifecycle invariants and shared debounce/coalesce helpers auditable in one file. */
import { ipcMain, type WebContents } from 'electron'
import * as path from 'node:path'
import { stat } from 'node:fs/promises'
import type { Event as WatcherEvent } from '@parcel/watcher'
import type { FsChangeEvent, FsChangedPayload } from '../../shared/types'
import {
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'
import { isWslPath } from '../wsl'
import { createWslWatcher } from './filesystem-watcher-wsl'
import type { WatchedRoot } from './filesystem-watcher-wsl'
import { MAX_BATCHED_WATCHER_EVENTS, queueWatcherEvents } from './filesystem-watcher-event-batch'
import {
  WATCH_BATCH_MAX_WAIT_MS,
  WATCH_BATCH_TRAILING_MS
} from '../../shared/filesystem-watch-batch-window'
import { disposeWatcherProcess, subscribeViaWatcherProcess } from './parcel-watcher-process'
import { isWatcherProcessFailure } from './parcel-watcher-process-failure'
import {
  onWatcherChildCapacityAvailable,
  WatcherChildCapacityError
} from './parcel-watcher-child-registry'
import { beginWatcherInstall, isWatcherRemovalInProgressError } from './watcher-removal-gate'
import {
  createWatcherRemovalDeadline,
  drainBeforeWatcherRemoval,
  WATCHER_REMOVAL_FINAL_DRAIN_RESERVE_MS,
  type WatcherRemovalDeadline
} from './watcher-removal-drain'
// Why: suppress high-churn dirs at the watcher level (separate from the File Explorer display filter, which only hides rows).
import { WATCHER_IGNORE_DIRS, buildParcelWatcherIgnoreOptions } from './filesystem-watcher-ignore'

// ── Per-root watcher state ───────────────────────────────────────────
// WatchedRoot/WatcherSubscription live in filesystem-watcher-wsl.ts so native and WSL watchers share one shape.

// ── Module state ─────────────────────────────────────────────────────

const watchedRoots = new Map<string, WatchedRoot>()

// Why: cache roots that failed watcher creation (e.g. WSL UNC paths) so we don't retry every worktree switch and spam the console with errors.
const UNWATCHABLE_ROOT_CACHE_MAX = 256
const unwatchableRoots = new Set<string>()

function rememberUnwatchableRoot(rootKey: string): void {
  // Why: deleted worktrees churn through unique paths; cap the set so retry suppression stays useful without retaining every failed path.
  unwatchableRoots.delete(rootKey)
  unwatchableRoots.add(rootKey)
  while (unwatchableRoots.size > UNWATCHABLE_ROOT_CACHE_MAX) {
    const oldest = unwatchableRoots.keys().next().value
    if (oldest === undefined) {
      break
    }
    unwatchableRoots.delete(oldest)
  }
}

// Why: key cleanup by sender WebContents (not per root) to avoid MaxListeners warnings when a workspace has many worktrees open.
const senderCleanupRegistered = new Set<number>()

// Why: recreating @parcel/watcher on Windows is expensive (ReadDirectoryChangesW + AV, 500ms+); a 30s grace lets rapid switches reuse the watcher.
const WATCHER_TEARDOWN_GRACE_MS = 30_000
const pendingTeardowns = new Map<string, ReturnType<typeof setTimeout>>()
// Why: @parcel/watcher unsubscribe does native async work that sender-destroy can start before shutdown, so will-quit must still await it.
const pendingLocalUnsubscribes = new Set<Promise<void>>()
const pendingLocalUnsubscribesByRoot = new Map<string, Set<Promise<void>>>()
const suspendedLocalWatcherListeners = new Map<
  string,
  { worktreePath: string; listeners: Map<number, WebContents> }
>()
// Why: an install cancelled by shutdown can't be revived by a waiter that resumes after a later call reopens the subsystem.
let localWatchersClosed = false
let localWatcherLifecycleGeneration = 0
const failedLocalUnsubscribes = new Map<string, unknown>()
// Why: a drain that timed out no longer gates the delete — Git removal already proceeded past it. Its
// late failure must not fail-close a *later* close of the same root, which would leave that path
// undeletable until the watcher process physically exits.
const abandonedLocalUnsubscribes = new WeakSet<Promise<void>>()
type LocalWatcherInstallToken = {
  cancelled: boolean
  listeners: Map<number, WebContents>
  abortController: AbortController
}
type LocalWatcherInstallResult = 'installed' | 'unavailable' | 'capacity' | 'cancelled'
type LocalWatcherCapacityRetry = {
  listeners: Map<number, WebContents>
  cancelWait: () => void
}
// Why: watcher creation is async; concurrent watch requests for the same root must share one install or later resolves orphan listeners.
const inFlightLocalInstalls = new Map<string, LocalWatcherInstallToken>()
const pendingLocalInstallPromises = new Map<string, Promise<LocalWatcherInstallResult>>()
const pendingLocalCapacityRetries = new Map<string, LocalWatcherCapacityRetry>()

function addInFlightLocalInstallListener(
  token: LocalWatcherInstallToken,
  sender: WebContents
): void {
  if (sender.isDestroyed() || token.abortController.signal.aborted) {
    return
  }
  token.listeners.set(sender.id, sender)
  token.cancelled = false
  registerSenderCleanup(sender)
}

function cleanupInFlightLocalInstallsForSender(senderId: number): void {
  for (const token of inFlightLocalInstalls.values()) {
    token.listeners.delete(senderId)
    if (token.listeners.size === 0) {
      token.cancelled = true
      // Why: abort so a pending native/forked subscription stops early (matches closeLocalWatcherForWorktreePath / closeAllWatchers).
      token.abortController.abort()
    }
  }
  for (const [rootKey, retry] of pendingLocalCapacityRetries) {
    retry.listeners.delete(senderId)
    if (retry.listeners.size === 0) {
      retry.cancelWait()
      pendingLocalCapacityRetries.delete(rootKey)
    }
  }
}

function takeLocalCapacityRetryListeners(rootKey: string): WebContents[] {
  const retry = pendingLocalCapacityRetries.get(rootKey)
  if (!retry) {
    return []
  }
  retry.cancelWait()
  pendingLocalCapacityRetries.delete(rootKey)
  return [...retry.listeners.values()].filter((listener) => !listener.isDestroyed())
}

function clearLocalCapacityRetry(rootKey: string): void {
  const retry = pendingLocalCapacityRetries.get(rootKey)
  retry?.cancelWait()
  pendingLocalCapacityRetries.delete(rootKey)
}

function scheduleLocalCapacityRetry(
  rootKey: string,
  worktreePath: string,
  listeners: Map<number, WebContents>
): void {
  const existing = pendingLocalCapacityRetries.get(rootKey)
  if (existing) {
    for (const listener of listeners.values()) {
      if (!listener.isDestroyed()) {
        existing.listeners.set(listener.id, listener)
      }
    }
    return
  }

  let retry!: LocalWatcherCapacityRetry
  const cancelWait = onWatcherChildCapacityAvailable(async () => {
    if (pendingLocalCapacityRetries.get(rootKey) !== retry) {
      return
    }
    pendingLocalCapacityRetries.delete(rootKey)
    await Promise.all(
      [...retry.listeners.values()].map(async (listener) => {
        if (listener.isDestroyed()) {
          return
        }
        await subscribe(worktreePath, listener).catch((error: unknown) => {
          if (!isWatcherRemovalInProgressError(error)) {
            console.error(`[filesystem-watcher] capacity retry failed for ${rootKey}:`, error)
          }
        })
      })
    )
  })
  retry = { listeners: new Map(), cancelWait }
  pendingLocalCapacityRetries.set(rootKey, retry)
  for (const listener of listeners.values()) {
    if (!listener.isDestroyed()) {
      retry.listeners.set(listener.id, listener)
      registerSenderCleanup(listener)
    }
  }
  if (retry.listeners.size === 0) {
    clearLocalCapacityRetry(rootKey)
  }
}

// ── Path normalization ───────────────────────────────────────────────

function normalizeRootPath(rootPath: string): string {
  let resolved = isWindowsAbsolutePathLike(rootPath)
    ? path.win32.resolve(rootPath)
    : path.resolve(rootPath)
  // Why: Windows watcher events may use lowercase drive letters vs stored uppercase; normalize so renderer casing stays consistent (§4.4).
  if (/^[a-zA-Z]:/.test(resolved)) {
    resolved = resolved.charAt(0).toUpperCase() + resolved.slice(1)
  }
  return resolved
}

function localWatcherRoot(rootPath: string): { key: string; path: string } {
  const normalizedPath = normalizeRootPath(rootPath)
  return {
    // Why: Windows drive/UNC paths are case-insensitive; cleanup must match the owner even when Git returns a different spelling.
    key: normalizeRuntimePathForComparison(normalizedPath),
    path: normalizedPath
  }
}

function normalizeEventPath(eventPath: string): string {
  let resolved = path.resolve(eventPath)
  if (/^[a-zA-Z]:/.test(resolved)) {
    resolved = resolved.charAt(0).toUpperCase() + resolved.slice(1)
  }
  return resolved
}

// ── Event coalescing ─────────────────────────────────────────────────
// Why: keep the last event per path in a flush window; delete→create emits both (delete cleans the subtree, create refreshes the parent), create→delete is dropped (§4.4).

function coalesceEvents(
  raw: WatcherEvent[]
): { type: 'create' | 'update' | 'delete'; path: string }[] {
  const lastByPath = new Map<string, { type: 'create' | 'update' | 'delete'; index: number }>()
  const deleteBeforeCreate = new Set<string>()

  for (let i = 0; i < raw.length; i++) {
    const evt = raw[i]
    const p = normalizeEventPath(evt.path)
    const prev = lastByPath.get(p)

    if (prev) {
      // delete followed by create → emit both
      if (prev.type === 'delete' && evt.type === 'create') {
        deleteBeforeCreate.add(p)
      }
      // create followed by delete → net no-op, remove both
      if (prev.type === 'create' && evt.type === 'delete') {
        lastByPath.delete(p)
        deleteBeforeCreate.delete(p)
        continue
      }
    }

    lastByPath.set(p, { type: evt.type, index: i })

    // Why: drop the stale delete when a later event supersedes delete→create, else output has a spurious delete for a file that still exists (§4.4).
    if (evt.type !== 'create' && deleteBeforeCreate.has(p)) {
      deleteBeforeCreate.delete(p)
    }
  }

  const result: { type: 'create' | 'update' | 'delete'; path: string }[] = []

  // Emit delete events first for paths that have delete→create
  for (const p of deleteBeforeCreate) {
    result.push({ type: 'delete', path: p })
  }

  // Emit the last event for each path
  for (const [p, entry] of lastByPath) {
    result.push({ type: entry.type, path: p })
  }

  return result
}

// ── Stat helper for isDirectory ──────────────────────────────────────

async function tryStatIsDirectory(filePath: string): Promise<boolean | undefined> {
  try {
    const s = await stat(filePath)
    return s.isDirectory()
  } catch {
    // Why: stat failure (EPERM, vanished file) → undefined; renderer treats it as a file event, the safe default (§4.4).
    return undefined
  }
}

// ── Flush and emit ───────────────────────────────────────────────────

function emitOverflowPayload(root: WatchedRoot): void {
  const { rootPath } = root
  const payload: FsChangedPayload = {
    worktreePath: rootPath,
    events: [{ kind: 'overflow', absolutePath: rootPath }]
  }
  for (const [, wc] of root.listeners) {
    if (!wc.isDestroyed()) {
      wc.send('fs:changed', payload)
    }
  }
}

async function flushBatch(root: WatchedRoot): Promise<void> {
  const overflowed = root.batch.overflowed
  const rawEvents = root.batch.events.splice(0)
  root.batch.overflowed = false
  root.batch.timer = null
  root.batch.firstEventAt = 0

  if ((rawEvents.length === 0 && !overflowed) || root.listeners.size === 0) {
    return
  }

  if (overflowed || rawEvents.length > MAX_BATCHED_WATCHER_EVENTS) {
    // Why: deletion storms can be too large to coalesce/stat per path; one overflow asks the renderer for the same conservative refresh.
    emitOverflowPayload(root)
    return
  }

  const coalesced = coalesceEvents(rawEvents)

  const events: FsChangeEvent[] = await Promise.all(
    coalesced.map(async (evt) => {
      // Why: a deleted path can't be stat'd; leave isDirectory undefined and let the renderer infer from dirCache.
      const isDirectory = evt.type === 'delete' ? undefined : await tryStatIsDirectory(evt.path)

      return {
        kind: evt.type,
        absolutePath: evt.path,
        isDirectory
      }
    })
  )

  const payload: FsChangedPayload = {
    worktreePath: root.rootPath,
    events
  }

  for (const [, wc] of root.listeners) {
    if (!wc.isDestroyed()) {
      wc.send('fs:changed', payload)
    }
  }
}

function scheduleBatchFlush(root: WatchedRoot): void {
  const now = Date.now()

  if (root.batch.firstEventAt === 0) {
    root.batch.firstEventAt = now
  }

  // If we've exceeded the max wait, flush immediately
  if (now - root.batch.firstEventAt >= WATCH_BATCH_MAX_WAIT_MS) {
    if (root.batch.timer) {
      clearTimeout(root.batch.timer)
    }
    void flushBatch(root)
    return
  }

  // Trailing-edge debounce: reset timer on each new event
  if (root.batch.timer) {
    clearTimeout(root.batch.timer)
  }
  root.batch.timer = setTimeout(() => void flushBatch(root), WATCH_BATCH_TRAILING_MS)
}

// ── Watcher creation ─────────────────────────────────────────────────

async function createWatcher(
  rootKey: string,
  rootPath: string,
  signal?: AbortSignal
): Promise<WatchedRoot> {
  const root: WatchedRoot = {
    subscription: null!,
    listeners: new Map(),
    batch: { events: [], overflowed: false, timer: null, firstEventAt: 0 },
    rootPath
  }

  try {
    // Why: if the error callback cleaned up before subscribe() resolved, its returned subscription is orphaned and leaks a native handle.
    let errorCleanedUp = false

    const watcherOptions = {
      ...buildParcelWatcherIgnoreOptions(WATCHER_IGNORE_DIRS),
      // Why: Parcel probes Watchman first, which prints a shell-level "watchman not recognized" error on Windows; pin the backend to suppress it.
      ...(process.platform === 'win32' ? { backend: 'windows' as const } : {})
    }

    const markWatcherInterrupted = (): void => {
      root.batch.overflowed = true
      scheduleBatchFlush(root)
    }

    // Why: fork the watcher process (issue #7547 — watcher.node teardown races crash the host); onInterruption marks overflow to refresh past the gap.
    root.subscription = await subscribeViaWatcherProcess(
      rootPath,
      (err, events) => {
        if (err) {
          // Why: treat watcher errors as overflow so the renderer conservatively refreshes rather than trusting possibly-invalid caches (§7.2, §7.3).
          console.error(`[filesystem-watcher] error for ${rootKey}:`, err)
          emitOverflowPayload(root)
          // Why: after an error the native subscription may be invalid (deleted root); tear down the dead watcher so it doesn't dangle (§7.3).
          if (root.batch.timer) {
            clearTimeout(root.batch.timer)
          }
          // Why: error callback can fire before subscribe() assigns root.subscription; guard against null so cleanup doesn't crash.
          if (root.subscription) {
            retainLocalWatcherPhysicalFailure(rootKey, err)
            void trackLocalUnsubscribe(rootKey, root)
          }
          errorCleanedUp = true
          watchedRoots.delete(rootKey)
          return
        }

        queueWatcherEvents(root.batch, events)
        scheduleBatchFlush(root)
      },
      watcherOptions,
      {
        delivery: { maxEventsPerBatch: MAX_BATCHED_WATCHER_EVENTS },
        // A child restart or bounded-queue overflow loses path precision; both need the same conservative renderer refresh.
        onInterruption: markWatcherInterrupted,
        onOverflow: markWatcherInterrupted,
        signal
      }
    )

    // Why: error callback already cleaned up watchedRoots before subscribe() resolved; unsubscribe this orphaned subscription so it doesn't leak.
    if (errorCleanedUp) {
      void trackLocalUnsubscribe(rootKey, root)
      throw new Error(`Watcher for ${rootKey} errored during subscribe`)
    }
  } catch (err) {
    // Why: watcher backend can throw synchronously on a deleted root/permission error; log rather than crash the main process (§7.3).
    console.error(`[filesystem-watcher] failed to subscribe ${rootKey}:`, err)
    throw err
  }

  return root
}

// ── Subscribe / Unsubscribe ──────────────────────────────────────────

function cleanupLocalWatchersForSender(senderId: number): void {
  for (const [rootKey, suspended] of suspendedLocalWatcherListeners) {
    suspended.listeners.delete(senderId)
    if (suspended.listeners.size === 0) {
      suspendedLocalWatcherListeners.delete(rootKey)
    }
  }
  cleanupInFlightLocalInstallsForSender(senderId)
  for (const [key, watchedRoot] of watchedRoots) {
    if (watchedRoot.listeners.has(senderId)) {
      watchedRoot.listeners.delete(senderId)
      if (watchedRoot.listeners.size === 0) {
        // Cancel any pending grace-period teardown for this root.
        const pending = pendingTeardowns.get(key)
        if (pending) {
          clearTimeout(pending)
          pendingTeardowns.delete(key)
        }
        if (watchedRoot.batch.timer) {
          clearTimeout(watchedRoot.batch.timer)
        }
        trackLocalUnsubscribe(key, watchedRoot)
        watchedRoots.delete(key)
      }
    }
  }
}

function trackLocalUnsubscribe(rootKey: string, root: WatchedRoot): Promise<void> {
  const rootUnsubscribes = pendingLocalUnsubscribesByRoot.get(rootKey) ?? new Set<Promise<void>>()
  pendingLocalUnsubscribesByRoot.set(rootKey, rootUnsubscribes)
  const unsubscribePromise = Promise.resolve()
    .then(() => root.subscription.unsubscribe())
    .finally(() => {
      pendingLocalUnsubscribes.delete(unsubscribePromise)
      rootUnsubscribes.delete(unsubscribePromise)
      if (rootUnsubscribes.size === 0) {
        pendingLocalUnsubscribesByRoot.delete(rootKey)
      }
    })
  pendingLocalUnsubscribes.add(unsubscribePromise)
  rootUnsubscribes.add(unsubscribePromise)
  // Why: swallow here to avoid unhandled rejections, but keep the original promise rejected so later destructive cleanup can fail closed.
  void unsubscribePromise.catch((error: unknown) => {
    if (!abandonedLocalUnsubscribes.has(unsubscribePromise)) {
      retainLocalWatcherPhysicalFailure(rootKey, error)
    }
    console.error(`[filesystem-watcher] unsubscribe error for ${rootKey}:`, error)
  })
  return unsubscribePromise
}

/** Mark unsubscribes whose drain timed out so their late failures stay out of failedLocalUnsubscribes. */
function abandonLocalUnsubscribes(promises: Iterable<Promise<void>>): void {
  for (const promise of promises) {
    abandonedLocalUnsubscribes.add(promise)
  }
}

function retainLocalWatcherPhysicalFailure(rootKey: string, error: unknown): void {
  if (!isWatcherProcessFailure(error) || !error.physicalExit) {
    return
  }
  failedLocalUnsubscribes.set(rootKey, error)
  void error.physicalExit.then(() => {
    if (failedLocalUnsubscribes.get(rootKey) === error) {
      failedLocalUnsubscribes.delete(rootKey)
    }
  })
}

function registerSenderCleanup(sender: WebContents): void {
  if (senderCleanupRegistered.has(sender.id)) {
    return
  }
  senderCleanupRegistered.add(sender.id)
  sender.once('destroyed', () => {
    senderCleanupRegistered.delete(sender.id)
    cleanupLocalWatchersForSender(sender.id)
  })
}

function addLocalWatchListener(rootKey: string, sender: WebContents): void {
  const root = watchedRoots.get(rootKey)
  if (!root || sender.isDestroyed()) {
    return
  }
  root.listeners.set(sender.id, sender)
  registerSenderCleanup(sender)
}

async function subscribe(
  worktreePath: string,
  sender: WebContents,
  generation = localWatcherLifecycleGeneration
): Promise<void> {
  if (localWatchersClosed || generation !== localWatcherLifecycleGeneration) {
    return
  }
  const finishInstall = beginWatcherInstall(worktreePath)
  try {
    await subscribeWhileRemovalAllowed(worktreePath, sender, generation)
  } finally {
    finishInstall()
  }
}

async function subscribeWhileRemovalAllowed(
  worktreePath: string,
  sender: WebContents,
  generation: number
): Promise<void> {
  if (localWatchersClosed || generation !== localWatcherLifecycleGeneration) {
    return
  }
  const { key: rootKey, path: rootPath } = localWatcherRoot(worktreePath)
  if (sender.isDestroyed()) {
    return
  }

  // Don't retry roots that already failed — avoids repeated error spam.
  if (unwatchableRoots.has(rootKey)) {
    rememberUnwatchableRoot(rootKey)
    return
  }

  let root = watchedRoots.get(rootKey)

  // Cancel any pending grace-period teardown — a new listener arrived.
  const pendingTeardown = pendingTeardowns.get(rootKey)
  if (pendingTeardown) {
    clearTimeout(pendingTeardown)
    pendingTeardowns.delete(rootKey)
  }
  const capacityRetryListeners = takeLocalCapacityRetryListeners(rootKey)

  if (root) {
    for (const listener of capacityRetryListeners) {
      addLocalWatchListener(rootKey, listener)
    }
    addLocalWatchListener(rootKey, sender)
    return
  }

  const pendingInstall = pendingLocalInstallPromises.get(rootKey)
  if (pendingInstall) {
    const inFlight = inFlightLocalInstalls.get(rootKey)
    const canJoinInstall = inFlight && !inFlight.abortController.signal.aborted
    if (canJoinInstall) {
      // Why: an unwatch may cancel an install while another renderer awaits the same root; a new live listener keeps it alive.
      addInFlightLocalInstallListener(inFlight, sender)
      for (const listener of capacityRetryListeners) {
        addInFlightLocalInstallListener(inFlight, listener)
      }
    }
    const result = await pendingInstall
    if (
      result === 'cancelled' &&
      !canJoinInstall &&
      !localWatchersClosed &&
      generation === localWatcherLifecycleGeneration
    ) {
      // Why: AbortSignal can't be revived; listeners arriving after cancellation wait out that generation, then own a fresh install.
      if (pendingLocalInstallPromises.get(rootKey) === pendingInstall) {
        pendingLocalInstallPromises.delete(rootKey)
      }
      const retryListeners = new Map(
        capacityRetryListeners.map((listener) => [listener.id, listener])
      )
      retryListeners.set(sender.id, sender)
      for (const listener of retryListeners.values()) {
        if (!listener.isDestroyed()) {
          await subscribeWhileRemovalAllowed(worktreePath, listener, generation)
        }
      }
      return
    }
    if (!inFlight) {
      if (result === 'installed') {
        for (const listener of capacityRetryListeners) {
          addLocalWatchListener(rootKey, listener)
        }
      } else if (result === 'capacity') {
        const retryListeners = new Map(
          capacityRetryListeners.map((listener) => [listener.id, listener])
        )
        retryListeners.set(sender.id, sender)
        scheduleLocalCapacityRetry(rootKey, worktreePath, retryListeners)
      }
    }
    if (
      result === 'installed' &&
      watchedRoots.has(rootKey) &&
      !sender.isDestroyed() &&
      (!inFlight || inFlight.listeners.has(sender.id))
    ) {
      addLocalWatchListener(rootKey, sender)
    }
    return
  }

  const cancelToken: LocalWatcherInstallToken = {
    cancelled: false,
    listeners: new Map(),
    abortController: new AbortController()
  }
  inFlightLocalInstalls.set(rootKey, cancelToken)
  for (const listener of capacityRetryListeners) {
    addInFlightLocalInstallListener(cancelToken, listener)
  }
  addInFlightLocalInstallListener(cancelToken, sender)
  const installPromise = doInstallLocalWatcher(rootKey, rootPath, worktreePath, cancelToken)
  pendingLocalInstallPromises.set(rootKey, installPromise)
  try {
    await installPromise
  } finally {
    if (pendingLocalInstallPromises.get(rootKey) === installPromise) {
      pendingLocalInstallPromises.delete(rootKey)
    }
  }
}

async function doInstallLocalWatcher(
  rootKey: string,
  rootPath: string,
  worktreePath: string,
  cancelToken: LocalWatcherInstallToken
): Promise<LocalWatcherInstallResult> {
  let root: WatchedRoot
  try {
    const s = await stat(rootPath)
    if (!s.isDirectory()) {
      console.warn(`[filesystem-watcher] not a directory: ${rootKey}`)
      rememberUnwatchableRoot(rootKey)
      return 'unavailable'
    }
  } catch {
    console.warn(`[filesystem-watcher] cannot stat root: ${rootKey}`)
    rememberUnwatchableRoot(rootKey)
    return 'unavailable'
  }

  try {
    // Why: WSL paths use one snapshot subprocess inside the distro so `wsl --shutdown` can kill it; native Windows uses @parcel/watcher.
    root = isWslPath(worktreePath)
      ? await createWslWatcher(
          rootKey,
          worktreePath,
          {
            ignoreDirs: WATCHER_IGNORE_DIRS,
            scheduleBatchFlush,
            watchedRoots
          },
          cancelToken.abortController.signal
        )
      : await createWatcher(rootKey, rootPath, cancelToken.abortController.signal)
  } catch (error) {
    // Why: setup can fail after its child misses the exit deadline; retain that owner even when the renderer-facing error is swallowed.
    retainLocalWatcherPhysicalFailure(rootKey, error)
    if (cancelToken.cancelled) {
      if (isWatcherProcessFailure(error) && error.code === 'process_unavailable') {
        throw error
      }
      return 'cancelled'
    }
    // Why: capacity is transient — allow retry once another child exits instead of caching this root as permanently failed.
    if (error instanceof WatcherChildCapacityError) {
      scheduleLocalCapacityRetry(rootKey, worktreePath, cancelToken.listeners)
      return 'capacity'
    }
    rememberUnwatchableRoot(rootKey)
    return 'unavailable'
  } finally {
    if (inFlightLocalInstalls.get(rootKey) === cancelToken) {
      inFlightLocalInstalls.delete(rootKey)
    }
  }

  const liveListeners = new Map(
    Array.from(cancelToken.listeners.entries()).filter(([, listener]) => !listener.isDestroyed())
  )
  if (cancelToken.cancelled || liveListeners.size === 0) {
    if (root.batch.timer) {
      clearTimeout(root.batch.timer)
    }
    void trackLocalUnsubscribe(rootKey, root)
    return 'cancelled'
  }

  root.listeners = liveListeners
  watchedRoots.set(rootKey, root)
  for (const listener of liveListeners.values()) {
    registerSenderCleanup(listener)
  }
  return 'installed'
}

function unsubscribe(worktreePath: string, senderId: number): void {
  const { key: rootKey } = localWatcherRoot(worktreePath)
  const suspended = suspendedLocalWatcherListeners.get(rootKey)
  suspended?.listeners.delete(senderId)
  if (suspended?.listeners.size === 0) {
    suspendedLocalWatcherListeners.delete(rootKey)
  }
  const capacityRetry = pendingLocalCapacityRetries.get(rootKey)
  if (capacityRetry) {
    capacityRetry.listeners.delete(senderId)
    if (capacityRetry.listeners.size === 0) {
      clearLocalCapacityRetry(rootKey)
    }
  }
  const inFlight = inFlightLocalInstalls.get(rootKey)
  if (inFlight) {
    inFlight.listeners.delete(senderId)
    inFlight.cancelled = inFlight.listeners.size === 0
    // Why: last normal disconnect must abort the pending native/forked install (same early-cancel as closeLocalWatcherForWorktreePath).
    if (inFlight.cancelled) {
      inFlight.abortController.abort()
    }
  }

  const root = watchedRoots.get(rootKey)
  if (!root) {
    return
  }

  root.listeners.delete(senderId)

  // Defer teardown when the last subscriber leaves so rapid worktree switches reuse the native watcher.
  if (root.listeners.size === 0) {
    if (root.batch.timer) {
      clearTimeout(root.batch.timer)
    }

    // Why: duplicate unwatch calls for a root would leak overwritten grace timers; keep just one.
    if (pendingTeardowns.has(rootKey)) {
      return
    }

    const teardownTimer = setTimeout(() => {
      pendingTeardowns.delete(rootKey)
      // Re-check: a new listener may have arrived during the grace period.
      const currentRoot = watchedRoots.get(rootKey)
      if (!currentRoot || currentRoot.listeners.size > 0) {
        return
      }
      void trackLocalUnsubscribe(rootKey, currentRoot)
      watchedRoots.delete(rootKey)
    }, WATCHER_TEARDOWN_GRACE_MS)

    pendingTeardowns.set(rootKey, teardownTimer)
  }
}

export async function closeLocalWatcherForWorktreePath(
  worktreePath: string,
  deadline: WatcherRemovalDeadline = createWatcherRemovalDeadline()
): Promise<void> {
  const { key: rootKey } = localWatcherRoot(worktreePath)
  const suspended = suspendedLocalWatcherListeners.get(rootKey) ?? {
    worktreePath,
    listeners: new Map<number, WebContents>()
  }
  for (const source of [
    pendingLocalCapacityRetries.get(rootKey)?.listeners,
    inFlightLocalInstalls.get(rootKey)?.listeners,
    watchedRoots.get(rootKey)?.listeners
  ]) {
    for (const [senderId, sender] of source ?? []) {
      if (!sender.isDestroyed()) {
        suspended.listeners.set(senderId, sender)
      }
    }
  }
  if (suspended.listeners.size > 0) {
    suspendedLocalWatcherListeners.set(rootKey, suspended)
  }
  clearLocalCapacityRetry(rootKey)
  const pendingTeardown = pendingTeardowns.get(rootKey)
  if (pendingTeardown) {
    clearTimeout(pendingTeardown)
    pendingTeardowns.delete(rootKey)
  }

  const inFlight = inFlightLocalInstalls.get(rootKey)
  if (inFlight) {
    // Why: Windows locks watched directories; deletion must cancel an in-flight subscription before Git removes the tree.
    inFlight.listeners.clear()
    inFlight.cancelled = true
    inFlight.abortController.abort()
  }
  // Why: abort alone is not enough if the native subscribe never settles; bound so delete cannot hang the app.
  const pendingInstall = pendingLocalInstallPromises.get(rootKey)
  const installDrain = await drainBeforeWatcherRemoval(
    pendingInstall,
    deadline,
    `local watcher install for ${rootKey}`,
    { reserveMs: WATCHER_REMOVAL_FINAL_DRAIN_RESERVE_MS }
  )
  if (installDrain === 'timeout') {
    // Why: an abandoned install never runs its own cleanup, so leaving these entries would make every
    // later watch of this root queue behind the same wedged promise. Identity-checked so a late settle
    // can't evict a newer install.
    if (pendingLocalInstallPromises.get(rootKey) === pendingInstall) {
      pendingLocalInstallPromises.delete(rootKey)
    }
    if (inFlight && inFlightLocalInstalls.get(rootKey) === inFlight) {
      inFlightLocalInstalls.delete(rootKey)
    }
  }
  const pendingUnsubscribes = pendingLocalUnsubscribesByRoot.get(rootKey)
  if (pendingUnsubscribes) {
    const draining = Array.from(pendingUnsubscribes)
    const unsubscribeDrain = await drainBeforeWatcherRemoval(
      // Why the per-promise catch: an already-abandoned unsubscribe belongs to a delete that finished
      // without it; re-raising its rejection here would fail a later close on stale news.
      Promise.all(
        draining.map((unsubscribe) =>
          abandonedLocalUnsubscribes.has(unsubscribe)
            ? unsubscribe.catch(() => undefined)
            : unsubscribe
        )
      ),
      deadline,
      `local watcher unsubscribe for ${rootKey}`,
      { reserveMs: WATCHER_REMOVAL_FINAL_DRAIN_RESERVE_MS }
    )
    if (unsubscribeDrain === 'timeout') {
      abandonLocalUnsubscribes(draining)
    }
  }
  if (failedLocalUnsubscribes.has(rootKey)) {
    throw failedLocalUnsubscribes.get(rootKey)
  }

  const root = watchedRoots.get(rootKey)
  if (!root) {
    return
  }
  if (root.batch.timer) {
    clearTimeout(root.batch.timer)
  }
  watchedRoots.delete(rootKey)
  // Why: the in-process Parcel fallback has no unsubscribe timeout of its own, so an unbounded await
  // here would hang delete forever and hold the removal gate. The promise stays tracked in
  // pendingLocalUnsubscribesByRoot, so a later close still observes its failure.
  const finalUnsubscribe = trackLocalUnsubscribe(rootKey, root)
  const finalDrain = await drainBeforeWatcherRemoval(
    finalUnsubscribe,
    deadline,
    `local watcher unsubscribe for ${rootKey}`
  )
  if (finalDrain === 'timeout') {
    abandonLocalUnsubscribes([finalUnsubscribe])
  }
}

export async function restoreLocalWatcherAfterFailedRemoval(worktreePath: string): Promise<void> {
  const { key: rootKey } = localWatcherRoot(worktreePath)
  const suspended = suspendedLocalWatcherListeners.get(rootKey)
  if (!suspended) {
    return
  }
  suspendedLocalWatcherListeners.delete(rootKey)
  const failures: unknown[] = []
  const failedListeners = new Map<number, WebContents>()
  for (const sender of suspended.listeners.values()) {
    if (sender.isDestroyed()) {
      continue
    }
    try {
      await subscribe(suspended.worktreePath, sender)
      sender.send('fs:changed', {
        worktreePath: suspended.worktreePath,
        events: [{ kind: 'overflow', absolutePath: suspended.worktreePath }]
      } satisfies FsChangedPayload)
    } catch (error) {
      failures.push(error)
      failedListeners.set(sender.id, sender)
    }
  }
  if (failures.length > 0) {
    suspendedLocalWatcherListeners.set(rootKey, {
      worktreePath: suspended.worktreePath,
      listeners: failedListeners
    })
    throw failures[0]
  }
}

export function forgetLocalWatcherRemovalSnapshot(worktreePath: string): void {
  suspendedLocalWatcherListeners.delete(localWatcherRoot(worktreePath).key)
}

// ── Public API ───────────────────────────────────────────────────────

export function registerFilesystemWatcherHandlers(): void {
  ipcMain.handle(
    'fs:watchWorktree',
    async (event, args: { worktreePath: string; connectionId?: string }): Promise<void> => {
      // Why: reopen the local subsystem for tests and post-shutdown reattachment; stale callers keep the prior generation.
      localWatchersClosed = false
      await subscribe(args.worktreePath, event.sender)
    }
  )

  ipcMain.handle(
    'fs:unwatchWorktree',
    (_event, args: { worktreePath: string; connectionId?: string }): void => {
      const senderId = _event.sender.id
      unsubscribe(args.worktreePath, senderId)
    }
  )
}

/** Tear down all watchers on app shutdown. */
export async function closeAllWatchers(): Promise<void> {
  senderCleanupRegistered.clear()
  unwatchableRoots.clear()
  suspendedLocalWatcherListeners.clear()
  for (const retry of pendingLocalCapacityRetries.values()) {
    retry.cancelWait()
  }
  pendingLocalCapacityRetries.clear()

  // Cancel any pending grace-period teardowns — we're tearing down everything.
  for (const timer of pendingTeardowns.values()) {
    clearTimeout(timer)
  }
  pendingTeardowns.clear()

  // Why: latch the subsystem shut so late installs can't register; generation bumps reject older-lifecycle waiters.
  localWatchersClosed = true
  localWatcherLifecycleGeneration += 1
  for (const token of inFlightLocalInstalls.values()) {
    token.listeners.clear()
    token.cancelled = true
    token.abortController.abort()
  }

  for (const [rootKey, root] of watchedRoots) {
    if (root.batch.timer) {
      clearTimeout(root.batch.timer)
    }
    await trackLocalUnsubscribe(rootKey, root).catch(() => undefined)
  }
  watchedRoots.clear()
  await Promise.allSettled(Array.from(pendingLocalUnsubscribes))
  failedLocalUnsubscribes.clear()
  // Why: kill the forked watcher process instead of watcher.node's crash-prone async teardown; process death frees native handles.
  disposeWatcherProcess()
}
