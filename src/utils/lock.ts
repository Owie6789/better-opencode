import { openSync, writeSync, closeSync, unlinkSync, statSync, readFileSync, utimesSync, writeFileSync, renameSync, linkSync, existsSync, mkdirSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname } from "node:path"
import { AsyncLocalStorage } from "node:async_hooks"

const lockAsyncStorage = new AsyncLocalStorage<Set<string>>()

export function createLockFile(lockPath: string, ownerId: string): boolean {
  try {
    const fd = openSync(lockPath, "wx")
    try {
      writeSync(fd, ownerId)
      const now = new Date()
      try {
        utimesSync(lockPath, now, now)
      } catch {
        // ignore utimes best-effort
      }
    } finally {
      closeSync(fd)
    }
    return true
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
    return false
  }
}

export function isLockStale(lockPath: string, staleMs: number): boolean {
  try {
    const st = statSync(lockPath)
    return Date.now() - st.mtimeMs > staleMs
  } catch {
    // ignore missing lock stat
    return false
  }
}

export function claimStaleLock(lockPath: string, ownerId: string, staleMs = 10_000): boolean {
  let contentBefore = ""
  let mtimeBefore = 0
  try {
    contentBefore = readFileSync(lockPath, "utf8")
    mtimeBefore = statSync(lockPath).mtimeMs
  } catch {
    // missing before snapshot
    return false
  }
  if (contentBefore === ownerId) return false
  if (Date.now() - mtimeBefore <= staleMs) return false

  // Atomic take: rename moves the stale lock out of the namespace, so exactly
  // one concurrent claimant can succeed; every loser observes ENOENT.
  const quarantine = `${lockPath}.${randomBytes(4).toString("hex")}.stale`
  try {
    renameSync(lockPath, quarantine)
  } catch {
    return false
  }

  let moved: string | null = null
  try {
    moved = readFileSync(quarantine, "utf8")
  } catch {
    // quarantine vanished under us
    moved = null
  }
  if (moved !== contentBefore) {
    if (moved !== null) {
      try {
        const fd = openSync(lockPath, "wx")
        try {
          writeSync(fd, moved)
        } finally {
          closeSync(fd)
        }
      } catch {
        // best-effort restore of a foreign lock
      }
    }
    try {
      unlinkSync(quarantine)
    } catch {}
    return false
  }
  try {
    unlinkSync(quarantine)
  } catch {}

  // Publish with an exclusive create: if a competing owner recreated the lock
  // between take and publish they win via EEXIST instead of being clobbered.
  const tmpClaim = `${lockPath}.${randomBytes(4).toString("hex")}.claim`
  writeFileSync(tmpClaim, ownerId)
  try {
    linkSync(tmpClaim, lockPath)
    return true
  } catch {
    return false
  } finally {
    try {
      unlinkSync(tmpClaim)
    } catch {}
  }
}

export function refreshLockFile(lockPath: string, ownerId: string): void {
  try {
    if (readFileSync(lockPath, "utf8") !== ownerId) return
    utimesSync(lockPath, new Date(), new Date())
  } catch {
    // missing lock during refresh
  }
}

export function releaseLockFile(lockPath: string, ownerId: string): void {
  try {
    const cur = readFileSync(lockPath, "utf8")
    if (cur === ownerId) unlinkSync(lockPath)
  } catch {
    // ignore missing on release
  }
}

export interface LockOptions {
  timeoutMs?: number
  staleMs?: number
}

const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = { timeoutMs: 5000, staleMs: 10_000 }

export function resolveLockOptions(opts?: LockOptions): Required<LockOptions> {
  return { ...DEFAULT_LOCK_OPTIONS, ...opts }
}

export function tryStaleClaim(lockPath: string, ownerId: string, staleMs: number): boolean {
  if (!isLockStale(lockPath, staleMs)) return false
  if (!claimStaleLock(lockPath, ownerId, staleMs)) return false
  try {
    return readFileSync(lockPath, "utf8") === ownerId
  } catch {
    return false
  }
}

export function sleepSyncMs(ms: number): void {
  try {
    const sab = new SharedArrayBuffer(4)
    const arr = new Int32Array(sab)
    Atomics.wait(arr, 0, 0, ms)
  } catch {
    const until = Date.now() + ms
    while (Date.now() < until) {
      // intentional empty busy-wait
    }
  }
}

function buildOwnerId(): string {
  return `${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`
}

function touchAfterCas(lockPath: string): void {
  try {
    utimesSync(lockPath, new Date(), new Date())
  } catch {
    // ignore utimes best-effort after CAS claim
  }
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, opts?: LockOptions): Promise<T> {
  const existingStore = lockAsyncStorage.getStore()
  if (existingStore?.has(lockPath)) return await fn()
  ensureDirFor(lockPath)
  const ownerId = buildOwnerId()
  const start = Date.now()
  const { timeoutMs, staleMs } = resolveLockOptions(opts)
  let acquired = false
  while (!createLockFile(lockPath, ownerId)) {
    if (tryStaleClaim(lockPath, ownerId, staleMs)) {
      acquired = true
      break
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Failed to acquire lock ${lockPath} after ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, 50))
  }
  if (acquired) touchAfterCas(lockPath)
  let refreshInterval: ReturnType<typeof setInterval> | null = null
  const doRefresh = (): void => refreshLockFile(lockPath, ownerId)
  refreshInterval = setInterval(doRefresh, 3000)
  const maybeUnref = refreshInterval as unknown as { unref?: () => void }
  if (maybeUnref.unref) maybeUnref.unref()
  const newStore = new Set(existingStore ?? [])
  newStore.add(lockPath)
  try {
    return await lockAsyncStorage.run(newStore, () => fn())
  } finally {
    if (refreshInterval) clearInterval(refreshInterval as unknown as NodeJS.Timeout)
    releaseLockFile(lockPath, ownerId)
  }
}

// Blocking acquisition for sync callbacks. The callback cannot refresh the
// lease while it runs; if it outlives staleMs another process may take over
// via claimStaleLock. Keep sync work short or use withFileLock instead.
export function withFileLockSync<T>(lockPath: string, fn: () => T, opts?: LockOptions): T {
  const existingStore = lockAsyncStorage.getStore()
  if (existingStore?.has(lockPath)) return fn()
  ensureDirFor(lockPath)
  const ownerId = buildOwnerId()
  const start = Date.now()
  const { timeoutMs, staleMs } = resolveLockOptions(opts)
  let acquired = false
  while (!createLockFile(lockPath, ownerId)) {
    if (tryStaleClaim(lockPath, ownerId, staleMs)) {
      acquired = true
      break
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Failed to acquire lock ${lockPath} after ${timeoutMs}ms`)
    sleepSyncMs(50)
  }
  if (acquired) touchAfterCas(lockPath)
  const newStore = new Set(existingStore ?? [])
  newStore.add(lockPath)
  try {
    return lockAsyncStorage.run(newStore, () => fn())
  } finally {
    releaseLockFile(lockPath, ownerId)
  }
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

export function ensureDirFor(filePath: string): void {
  ensureDir(dirname(filePath))
}
