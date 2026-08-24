import { existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, statSync, readFileSync, writeFileSync, utimesSync } from "node:fs"
import { dirname } from "node:path"

export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const dir = dirname(lockPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const ownerId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const start = Date.now()
  const timeoutMs = 5000
  const retryMs = 50
  const staleMs = 10_000
  let acquired = false
  let refreshInterval: ReturnType<typeof setInterval> | null = null
  while (!acquired) {
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
      acquired = true
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "EEXIST") throw err
      try {
        const st = statSync(lockPath)
        const age = Date.now() - st.mtimeMs
        if (age > staleMs) {
          let content = ""
          try {
            content = readFileSync(lockPath, "utf8")
          } catch {}
          if (content !== ownerId) {
            try {
              unlinkSync(lockPath)
            } catch {}
          }
          continue
        }
      } catch {}
      if (Date.now() - start > timeoutMs) throw new Error(`Failed to acquire lock ${lockPath} after ${timeoutMs}ms`)
      await new Promise((r) => setTimeout(r, retryMs))
    }
  }
  refreshInterval = setInterval(() => {
    try {
      const cur = readFileSync(lockPath, "utf8")
      if (cur === ownerId) {
        writeFileSync(lockPath, ownerId, "utf8")
      }
    } catch {}
  }, 3000)
  if (refreshInterval && typeof (refreshInterval as unknown as { unref: () => void }).unref === "function") {
    ;(refreshInterval as unknown as { unref: () => void }).unref()
  }
  try {
    return await fn()
  } finally {
    if (refreshInterval) clearInterval(refreshInterval as unknown as NodeJS.Timeout)
    try {
      const cur = readFileSync(lockPath, "utf8")
      if (cur === ownerId) unlinkSync(lockPath)
    } catch {}
  }
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}
