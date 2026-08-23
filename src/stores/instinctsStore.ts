import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { type Instinct, InstinctSchema } from "../types.js"
import { Logger } from "../utils/logger.js"

const MAX_CHARS_SNAPSHOT = 2200
const MAX_CHARS_WORKING = 1375

function instinctsPath(): string {
  return join(homedir(), ".cache", "better-opencode", "instincts.json")
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

  save(): void {
    ensureDirFor(this.filePath)
    const data = JSON.stringify(this.instincts, null, 2)
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, data, "utf8")
    writeFileSync(this.filePath, data, "utf8")
  }

  all(): Instinct[] {
    return this.load()
  }

  add(instinct: Instinct): void {
    const parsed = InstinctSchema.parse(instinct)
    this.load()
    const idx = this.instincts.findIndex((i) => i.id === parsed.id)
    if (idx >= 0) this.instincts[idx] = parsed
    else this.instincts.push(parsed)
    this.enforceCap()
    this.save()
  }

  upsert(instinct: Instinct): void {
    this.add(instinct)
  }

  remove(id: string): boolean {
    this.load()
    const before = this.instincts.length
    this.instincts = this.instincts.filter((i) => i.id !== id)
    if (this.instincts.length !== before) {
      this.save()
      return true
    }
    return false
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
    this.load()
    const now = Date.now()
    const before = this.instincts.length
    const evicted: Instinct[] = []
    this.instincts = this.instincts.filter((inst) => {
      const ageDays = (now - inst.updatedAt) / (1000 * 60 * 60 * 24)
      const ttl = inst.ttlDays || ttlDaysDefault
      const isExpired = ageDays > ttl && this.decayedScore(inst) < 0.5
      if (isExpired) evicted.push(inst)
      return !isExpired
    })
    if (evicted.length > 0) this.save()
    if (before !== this.instincts.length) {
      this.logger.info(`GC evicted ${evicted.length} instincts`)
    }
    return evicted
  }

  count(): number {
    return this.load().length
  }

  clear(): void {
    this.instincts = []
    this.save()
  }
}
