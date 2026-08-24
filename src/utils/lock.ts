import { existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, statSync, readFileSync, writeFileSync, utimesSync } from "node:fs"
import { dirname } from "node:path"
import { randomBytes } from "node:crypto"

function createLockFile(lockPath: string, ownerId: string): boolean {
  try {
    const fd = openSync(lockPath, "wx")
    try {
      writeSync(fd, ownerId)
      const now = new Date()
      try {
        utimesSync(lockPath, now, now)
      } catch {}
    } finally {
      closeSync(fd)
    }
    return true
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
    return false
  }
}

function isLockStale(lockPath: string, staleMs: number): boolean {
  try {
    const st = statSync(lockPath)
    return Date.now() - st.mtimeMs > staleMs
  } catch {
    return false
  }
}

function claimStaleLock(lockPath: string, ownerId: string): void {
  let content = ""
  try {
    content = readFileSync(lockPath, "utf8")
  } catch {}
  if (content === ownerId) return
  try {
    unlinkSync(lockPath)
  } catch {}
}

function refreshLockFile(lockPath: string, ownerId: string): void {
  try {
    const cur = readFileSync(lockPath, "utf8")
    if (cur === ownerId) writeFileSync(lockPath, ownerId, "utf8")
  } catch {}
}

function releaseLockFile(lockPath: string, ownerId: string): void {
  try {
    const cur = readFileSync(lockPath, "utf8")
    if (cur === ownerId) unlinkSync(lockPath)
  } catch {}
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
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
      claimStaleLock(lockPath, ownerId)
      continue
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Failed to acquire lock ${lockPath} after ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, retryMs))
  }

  const doRefresh = (): void => refreshLockFile(lockPath, ownerId)
  refreshInterval = setInterval(doRefresh, 3000)
  const maybeUnref = refreshInterval as unknown as { unref?: () => void }
  if (maybeUnref.unref) maybeUnref.unref()
  try {
    return await fn()
  } finally {
    if (refreshInterval) clearInterval(refreshInterval as unknown as NodeJS.Timeout)
    releaseLockFile(lockPath, ownerId)
  }
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}
