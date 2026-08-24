import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, fsyncSync, closeSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { createHash, randomBytes } from "node:crypto"
import { type Instinct, InstinctSchema } from "../types.js"
import { Logger } from "../utils/logger.js"
import { withFileLockSync } from "../utils/lock.js"

const MAX_CHARS_SNAPSHOT = 2200
const MAX_CHARS_WORKING = 1375

function instinctsPath(repoRoot?: string): string {
  if (repoRoot) {
    const h = repoHashForPath(repoRoot)
    return join(homedir(), ".cache", "better-opencode", h, "instincts.json")
  }
  return join(homedir(), ".cache", "better-opencode", "instincts.json")
}

function repoHashForPath(p: string): string {
  return createHash("sha256").update(p, "utf8").digest("hex").slice(0, 12)
}

export function instinctsPathForRepo(repoRoot: string): string {
  return instinctsPath(repoRoot)
}

function ensureDirFor(file: string): void {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export class InstinctsStore {
  private instincts: Instinct[] = []
  private loaded = false

  constructor(
    private readonly filePath: string = instinctsPath(),
    private readonly logger: Logger = new Logger(false),
    private readonly maxInstincts = 200,
  ) {}

  get lockPath(): string {
    return `${this.filePath}.lock`
  }

  get lockFilePath(): string {
    return this.lockPath
  }

  load(): Instinct[] {
    if (this.loaded) return [...this.instincts]
    if (!existsSync(this.filePath)) {
      this.instincts = []
      this.loaded = true
      return []
    }
    try {
      const raw = readFileSync(this.filePath, "utf8")
      const arr = JSON.parse(raw) as unknown[]
      const parsed: Instinct[] = []
      for (const item of arr) {
        const r = InstinctSchema.safeParse(item)
        if (r.success) parsed.push(r.data)
        else this.logger.warn("Skipping invalid instinct", r.error.flatten())
      }
      this.instincts = parsed
      this.loaded = true
      return [...this.instincts]
    } catch (err) {
      this.logger.warn("Failed to load instincts", err)
      this.instincts = []
      this.loaded = true
      return []
    }
  }

  private fsyncFile(path: string): void {
    try {
      const fd = openSync(path, "r")
      try {
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      const isWindows = process.platform === "win32"
      const tolerated = isWindows || e.code === "EPERM" || e.code === "EINVAL" || e.code === "ENOSYS"
      if (!tolerated) throw err
      this.logger.warn("file fsync not supported on this platform, continuing without fsync")
    }
  }

  private fsyncDir(dir: string): void {
    try {
      const dirFd = openSync(dir, "r")
      try {
        fsyncSync(dirFd)
      } finally {
        closeSync(dirFd)
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      const isWindows = process.platform === "win32"
      const tolerated = isWindows || e.code === "EINVAL" || e.code === "EPERM" || e.code === "ENOSYS"
      if (!tolerated) throw err
      this.logger.warn("directory fsync not supported on this platform, durability reduced to file fsync only")
    }
  }

  private saveInternal(): void {
    ensureDirFor(this.filePath)
    const data = JSON.stringify(this.instincts, null, 2)
    const nonce = randomBytes(3).toString("hex")
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.${nonce}.tmp`
    writeFileSync(tmp, data, "utf8")
    try {
      this.fsyncFile(tmp)
    } catch (err) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {}
      throw err
    }
    try {
      renameSync(tmp, this.filePath)
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== "ENOENT") throw err
      try {
        if (existsSync(tmp)) writeFileSync(this.filePath, data, "utf8")
      } catch {}
    } finally {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {}
    }
    this.fsyncDir(dirname(this.filePath))
  }

  save(): void {
    withFileLockSync(this.lockPath, () => this.saveInternal())
  }

  all(): Instinct[] {
    return this.load()
  }

  add(instinct: Instinct): void {
    const parsed = InstinctSchema.parse(instinct)
    withFileLockSync(this.lockPath, () => {
      this.loaded = false
      this.load()
      const idx = this.instincts.findIndex((i) => i.id === parsed.id)
      if (idx >= 0) this.instincts[idx] = parsed
      else this.instincts.push(parsed)
      this.enforceCap()
      this.saveInternal()
    })
  }

  upsert(instinct: Instinct): void {
    this.add(instinct)
  }

  upsertWithoutLock(instinct: Instinct): void {
    const parsed = InstinctSchema.parse(instinct)
    const idx = this.instincts.findIndex((i) => i.id === parsed.id)
    if (idx >= 0) this.instincts[idx] = parsed
    else this.instincts.push(parsed)
    this.enforceCap()
    this.saveInternal()
  }

  remove(id: string): boolean {
    let removed = false
    withFileLockSync(this.lockPath, () => {
      this.loaded = false
      this.load()
      const before = this.instincts.length
      this.instincts = this.instincts.filter((i) => i.id !== id)
      if (this.instincts.length !== before) {
        this.saveInternal()
        removed = true
      }
    })
    return removed
  }

  findById(id: string): Instinct | undefined {
    return this.load().find((i) => i.id === id)
  }

  search(query: string, limit = 10): Instinct[] {
    const q = query.toLowerCase()
    const all = this.load()
    const scored = all
      .map((inst) => {
        const text = inst.text.toLowerCase()
        let score = 0
        if (text.includes(q)) score += 10
        const words = q.split(/\s+/)
        for (const w of words) if (text.includes(w)) score += 1
        score += inst.score * 0.5
        return { inst, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((x) => x.inst)
  }

  frozenSnapshot(maxChars = MAX_CHARS_SNAPSHOT): string {
    const all = this.load()
    if (all.length === 0) return ""
    const sorted = [...all].sort((a, b) => b.score - a.score)
    const decayed = sorted.map((inst) => ({
      ...inst,
      decayedScore: this.decayedScore(inst),
    }))
    decayed.sort((a, b) => b.decayedScore - a.decayedScore)
    let out = ""
    for (const d of decayed) {
      const entry = `- ${d.text} [score:${d.score.toFixed(1)} hits:${d.hits}]\n`
      if (out.length + entry.length > maxChars) break
      out += entry
    }
    return out.trim()
  }

  workingContext(maxChars = MAX_CHARS_WORKING): string {
    return this.frozenSnapshot(maxChars)
  }

  enforceCap(): void {
    if (this.instincts.length <= this.maxInstincts) return
    const withDecay = this.instincts
      .map((inst) => ({ inst, s: this.decayedScore(inst) }))
      .sort((a, b) => b.s - a.s)
    this.instincts = withDecay.slice(0, this.maxInstincts).map((x) => x.inst)
  }

  decayedScore(inst: Instinct): number {
    const ageDays = (Date.now() - inst.updatedAt) / (1000 * 60 * 60 * 24)
    const ttl = inst.ttlDays || 14
    return inst.score * Math.exp(-ageDays / ttl)
  }

  gc(ttlDaysDefault = 14): Instinct[] {
    let evicted: Instinct[] = []
    withFileLockSync(this.lockPath, () => {
      this.loaded = false
      this.load()
      const now = Date.now()
      const before = this.instincts.length
      evicted = []
      this.instincts = this.instincts.filter((inst) => {
        const ageDays = (now - inst.updatedAt) / (1000 * 60 * 60 * 24)
        const ttl = inst.ttlDays || ttlDaysDefault
        const isExpired = ageDays > ttl && this.decayedScore(inst) < 0.5
        if (isExpired) evicted.push(inst)
        return !isExpired
      })
      if (evicted.length > 0) this.saveInternal()
      if (before !== this.instincts.length) {
        this.logger.info(`GC evicted ${evicted.length} instincts`)
      }
    })
    return evicted
  }

  count(): number {
    return this.load().length
  }

  clear(): void {
    withFileLockSync(this.lockPath, () => {
      this.instincts = []
      this.saveInternal()
    })
  }
}
