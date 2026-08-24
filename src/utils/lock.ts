import { existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, statSync, readFileSync, writeFileSync, utimesSync, fsyncSync } from "node:fs"
import { dirname } from "node:path"
import { randomBytes } from "node:crypto"
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
  try {
    const stAfter = statSync(lockPath)
    const contentAfter = readFileSync(lockPath, "utf8")
    if (contentAfter !== contentBefore) return false
    if (stAfter.mtimeMs !== mtimeBefore) return false
    unlinkSync(lockPath)
    return true
  } catch {
    // concurrent takeover
    return false
  }
}

export function refreshLockFile(lockPath: string, ownerId: string): void {
  try {
    const cur = readFileSync(lockPath, "utf8")
    if (cur !== ownerId) return
    writeFileSync(lockPath, ownerId, "utf8")
    try {
      const fd = openSync(lockPath, "r")
      try {
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    } catch {
      // ignore fsync best-effort
    }
    try {
      utimesSync(lockPath, new Date(), new Date())
    } catch {
      // ignore utimes best-effort
    }
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

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const existingStore = lockAsyncStorage.getStore()
  if (existingStore?.has(lockPath)) {
    return await fn()
  }
  const dir = dirname(lockPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const ownerId = `${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`
  const start = Date.now()
  const timeoutMs = 5000
  const retryMs = 50
  const staleMs = 10_000
  let refreshInterval: ReturnType<typeof setInterval> | null = null

  while (!createLockFile(lockPath, ownerId)) {
    if (isLockStale(lockPath, staleMs)) {
      claimStaleLock(lockPath, ownerId, staleMs)
      continue
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Failed to acquire lock ${lockPath} after ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, retryMs))
  }

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

export function withFileLockSync<T>(lockPath: string, fn: () => T): T {
  const existingStore = lockAsyncStorage.getStore()
  if (existingStore?.has(lockPath)) {
    return fn()
  }
  const dir = dirname(lockPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const ownerId = `${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`
  const start = Date.now()
  const timeoutMs = 5000
  const staleMs = 10_000
  while (!createLockFile(lockPath, ownerId)) {
    if (isLockStale(lockPath, staleMs)) {
      claimStaleLock(lockPath, ownerId, staleMs)
      continue
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Failed to acquire lock ${lockPath} after ${timeoutMs}ms`)
    try {
      const sab = new SharedArrayBuffer(4)
      const arr = new Int32Array(sab)
      Atomics.wait(arr, 0, 0, 50)
    } catch {
      const until = Date.now() + 50
      while (Date.now() < until) {}
    }
  }
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
