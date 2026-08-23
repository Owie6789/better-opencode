import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { Logger } from "../utils/logger.js"

interface CacheEntry {
  hash: string
  blob: unknown
  createdAt: number
}

export class CacheStore {
  private memory = new Map<string, { blob: unknown; createdAt: number }>()
  private readonly maxMemory = 1000
  private fileCache = new Map<string, CacheEntry>()
  private loaded = false

  constructor(
    private readonly filePath: string = join(homedir(), ".cache", "better-opencode", "cache.json"),
    private readonly logger: Logger = new Logger(false),
  ) {}

  private ensureLoaded(): void {
    if (this.loaded) return
    if (!existsSync(this.filePath)) {
      this.loaded = true
      return
    }
    try {
      const raw = readFileSync(this.filePath, "utf8")
      const arr = JSON.parse(raw) as CacheEntry[]
      for (const e of arr) this.fileCache.set(e.hash, e)
    } catch (err) {
      this.logger.warn("cache load failed", err)
    }
    this.loaded = true
  }

  private persist(): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const arr = [...this.fileCache.values()]
    writeFileSync(this.filePath, JSON.stringify(arr, null, 2), "utf8")
  }

  get<T>(hash: string): T | undefined {
    if (this.memory.has(hash)) return this.memory.get(hash)?.blob as T
    this.ensureLoaded()
    const e = this.fileCache.get(hash)
    if (e) {
      this.setMemory(hash, e.blob)
      return e.blob as T
    }
    return undefined
  }

  set(hash: string, blob: unknown): void {
    this.setMemory(hash, blob)
    this.ensureLoaded()
    this.fileCache.set(hash, { hash, blob, createdAt: Date.now() })
    while (this.fileCache.size > this.maxMemory) {
      const oldest = this.fileCache.keys().next().value as string | undefined
      if (!oldest) break
      this.fileCache.delete(oldest)
    }
    this.persist()
  }

  has(hash: string): boolean {
    if (this.memory.has(hash)) return true
    this.ensureLoaded()
    return this.fileCache.has(hash)
  }

  delete(hash: string): void {
    this.memory.delete(hash)
    this.ensureLoaded()
    this.fileCache.delete(hash)
    this.persist()
  }

  clear(): void {
    this.memory.clear()
    this.fileCache.clear()
    this.persist()
  }

  stats(): { memorySize: number; fileSize: number } {
    this.ensureLoaded()
    return { memorySize: this.memory.size, fileSize: this.fileCache.size }
  }

  private setMemory(hash: string, blob: unknown): void {
    if (this.memory.size >= this.maxMemory) {
      const first = this.memory.keys().next().value as string | undefined
      if (first) this.memory.delete(first)
    }
    this.memory.set(hash, { blob, createdAt: Date.now() })
  }
}
