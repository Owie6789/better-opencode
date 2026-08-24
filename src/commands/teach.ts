import { createHash } from "node:crypto"
import type { Instinct } from "../types.js"
import { InstinctsStore } from "../stores/instinctsStore.js"
import { scrubSecrets, scanSkillText } from "../rag/injectionScanner.js"
import { Logger } from "../utils/logger.js"

export interface TeachResult {
  instinct: Instinct
  message: string
}

export class TeachCommand {
  constructor(
    private readonly instincts: InstinctsStore,
    private readonly logger: Logger = new Logger(false),
  ) {}

  async execute(text: string, _projectRoot?: string): Promise<TeachResult & { ok: boolean }> {
    const scan = scanSkillText(text)
    if (!scan.safe) {
      throw new Error(`Blocked injection: ${scan.reason} ${scan.matched ?? ""}`.trim())
    }
    const clean = scrubSecrets(text.trim())
    if (clean.length < 5) throw new Error("teach text too short")
    if (clean.length > 4000) throw new Error("teach text too long (max 4000)")

    const id = createHash("sha256").update(clean).digest("hex").slice(0, 12)
    const now = Date.now()

    let instinct!: Instinct
    this.instincts.mutate(() => {
      const existing = this.instincts.findById(id)
      instinct = existing
        ? {
            ...existing,
            text: clean,
            hits: existing.hits + 1,
            successRate: Math.min(1, existing.successRate + 0.05),
            explicitWeight: Math.min(10, existing.explicitWeight + 3),
            updatedAt: now,
            score: existing.score + 3,
            confidence: Math.min(10, existing.confidence + 1),
          }
        : {
            id,
            text: clean,
            score: 6,
            confidence: 7,
            hits: 1,
            successRate: 0.9,
            tokenDelta: 0,
            toolCallsDelta: 0,
            explicitWeight: 3,
            createdAt: now,
            updatedAt: now,
            ttlDays: 30,
            source: "explicit",
            tags: ["teach"],
          }
      this.instincts.upsertWithoutLock(instinct)
    })
    this.logger.info(`Teach created ${id} weight=${instinct.explicitWeight}`)
    return { ok: true, instinct, message: `Learned: "${clean.slice(0, 80)}" (id=${id} score=${instinct.score.toFixed(1)})` }
  }
}
