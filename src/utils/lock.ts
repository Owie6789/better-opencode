import { existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, statSync } from "node:fs"
import { dirname } from "node:path"

export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const dir = dirname(lockPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const start = Date.now()
  const timeoutMs = 5000
  const retryMs = 50
  while (true) {
    try {
      const fd = openSync(lockPath, "wx")
      try {
        writeSync(fd, String(process.pid))
      } finally {
        closeSync(fd)
      }
      break
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "EEXIST") throw err
      try {
        const st = statSync(lockPath)
        const age = Date.now() - st.mtimeMs
        if (age > 10_000) {
          try {
            unlinkSync(lockPath)
          } catch {}
          continue
        }
      } catch {}
      if (Date.now() - start > timeoutMs) throw new Error(`Failed to acquire lock ${lockPath} after ${timeoutMs}ms`)
      await new Promise((r) => setTimeout(r, retryMs))
    }
  }
  try {
    return await fn()
  } finally {
    try {
      unlinkSync(lockPath)
    } catch {}
  }
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}
