import type { Instinct } from "../types.js"
import { InstinctsStore } from "../stores/instinctsStore.js"
import { Logger } from "../utils/logger.js"

export class CuratorGC {
  constructor(
    private readonly store: InstinctsStore,
    private readonly logger: Logger = new Logger(false),
    private readonly maxInstincts = 200,
    private readonly ttlDays = 14,
  ) {}

  run(): Instinct[] {
    const evictedByTtl = this.store.gc(this.ttlDays)
    const all = this.store.all()
    if (all.length <= this.maxInstincts) return evictedByTtl

    const scored = all
      .map((inst) => ({
        inst,
        decayed: inst.score * Math.exp(-(Date.now() - inst.updatedAt) / (1000 * 60 * 60 * 24 * this.ttlDays)),
      }))
      .sort((a, b) => b.decayed - a.decayed)

    const keep = new Set(scored.slice(0, this.maxInstincts).map((x) => x.inst.id))
    const extraEvicted: Instinct[] = []
    for (const { inst } of scored.slice(this.maxInstincts)) {
      if (!keep.has(inst.id)) {
        this.store.remove(inst.id)
        extraEvicted.push(inst)
      }
    }
    if (extraEvicted.length > 0) {
      this.logger.info(`GC cap evicted ${extraEvicted.length} over ${this.maxInstincts}`)
    }
    return [...evictedByTtl, ...extraEvicted]
  }

  shouldArchive(inst: Instinct): boolean {
    const ageDays = (Date.now() - inst.updatedAt) / (1000 * 60 * 60 * 24)
    return ageDays > 30 && inst.score < 0.5
  }
}
