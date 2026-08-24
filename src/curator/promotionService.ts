import { existsSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type { Instinct } from "../types.js"
import { SkillStore } from "../stores/skillStore.js"
import { Guardrails } from "./guardrails.js"
import { scanSkillText } from "../rag/injectionScanner.js"
import { Logger } from "../utils/logger.js"

export interface PromotionResult {
  promoted: boolean
  slug?: string
  reason?: string
}

export class PromotionService {
  constructor(
    private readonly skillStore: SkillStore,
    private readonly guardrails: Guardrails = new Guardrails(5),
    private readonly logger: Logger = new Logger(false),
  ) {}

  tryPromote(instinct: Instinct): PromotionResult {
    if (!this.guardrails.canPromote()) {
      return { promoted: false, reason: `guardrail: max ${this.guardrails.getCount()}/session` }
    }

    if (instinct.score < 3) {
      return { promoted: false, reason: `score ${instinct.score.toFixed(2)} < threshold 3` }
    }

    if (instinct.hits < 3) {
      return { promoted: false, reason: `hits ${instinct.hits} < 3` }
    }

    const scan = scanSkillText(instinct.text)
    if (!scan.safe) {
      return { promoted: false, reason: `blocked: ${scan.reason} ${scan.matched ?? ""}` }
    }

    if (instinct.text.toLowerCase().includes(".env") && instinct.text.includes("read")) {
      this.logger.warn(`Promotion blocked path traversal check: ${instinct.id}`)
    }

    const skill = this.skillStore.promote({
      instinctId: instinct.id,
      text: instinct.text,
      confidence: instinct.confidence,
      tags: instinct.tags,
    })

    this.guardrails.recordPromotion()

    const archiveOk = this.skillStore.archiveToT3(skill.slug)
    if (!archiveOk) {
      this.logger.warn(`T3 archive failed for ${skill.slug}`)
    }

    this.logger.info(`Promoted ${instinct.id} → ${skill.slug} v${skill.frontmatter.version}`)
    return { promoted: true, slug: skill.slug }
  }

  enforceHistoryLimit(slug: string, maxHistory = 10): void {
    try {
      const skill = this.skillStore.readSkill(slug)
      if (!skill) return
      const historyDir = join(skill.historyDir)
      if (!existsSync(historyDir)) return
      const files = readdirSync(historyDir).filter((f: string) => f.endsWith(".md")).sort()
      if (files.length > maxHistory) {
        for (const f of files.slice(0, files.length - maxHistory)) {
          unlinkSync(join(historyDir, f))
        }
      }
    } catch {
      // best effort
    }
  }
}
