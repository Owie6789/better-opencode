import { createHash } from "node:crypto"
import type { Instinct } from "../types.js"
import { SessionState } from "../state/sessionState.js"
import { InstinctsStore } from "../stores/instinctsStore.js"
import { Logger } from "../utils/logger.js"

export interface EvolverOpts {
  confidenceThreshold: number
  minHits: number
  minSuccessRate: number
}

export class Evolver {
  constructor(
    private readonly instincts: InstinctsStore,
    private readonly logger: Logger = new Logger(false),
    private readonly opts: EvolverOpts = { confidenceThreshold: 3, minHits: 3, minSuccessRate: 0.6 },
  ) {}

  scoreInstinct(inst: Instinct): number {
    const reuse = inst.hits * 1.0
    const success = inst.successRate * 1.5
    const tokenNorm = Math.min(inst.tokenDelta / 1000, 2) * 0.8
    const explicit = inst.explicitWeight * 3.0
    const toolCallBonus = Math.min(inst.toolCallsDelta / 10, 1) * 0.5
    return reuse + success + tokenNorm + explicit + toolCallBonus
  }

  evaluate(inst: Instinct): { score: number; promote: boolean } {
    const score = this.scoreInstinct(inst)
    const promote =
      score >= this.opts.confidenceThreshold &&
      inst.hits >= this.opts.minHits &&
      inst.successRate >= this.opts.minSuccessRate
    return { score, promote }
  }

  curate(session: SessionState): Instinct[] {
    const ledger = session.getLedger()
    if (ledger.length < 3) return []

    const errorFixPairs = session.getErrorFixPairs()
    const candidates: Instinct[] = []

    if (errorFixPairs.length > 0) {
      for (const pair of errorFixPairs.slice(-3)) {
        const text = this.synthesizeErrorFix(pair)
        if (!text) continue
        const id = createHash("sha256").update(text).digest("hex").slice(0, 12)
        const existing = this.instincts.findById(id)
        const inst: Instinct = existing
          ? {
              ...existing,
              hits: existing.hits + 1,
              successRate: Math.min(1, existing.successRate + 0.1),
              updatedAt: Date.now(),
              score: this.scoreInstinct({ ...existing, hits: existing.hits + 1 }),
            }
          : {
              id,
              text,
              score: 2.5,
              confidence: 3.5,
              hits: 1,
              successRate: 0.7,
              tokenDelta: 0,
              toolCallsDelta: 1,
              explicitWeight: 0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              ttlDays: 14,
              source: "implicit",
              tags: ["error-fix", pair.errorTool],
            }
        candidates.push(inst)
      }
    }

    const toolGraph = this.buildToolGraphSummary(ledger)
    if (toolGraph) {
      const id = createHash("sha256").update(toolGraph).digest("hex").slice(0, 12)
      const existing = this.instincts.findById(id)
      if (!existing) {
        candidates.push({
          id,
          text: toolGraph,
          score: 2.0,
          confidence: 3.0,
          hits: 1,
          successRate: 0.65,
          tokenDelta: session.getData().tokenUsage.total,
          toolCallsDelta: ledger.length,
          explicitWeight: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ttlDays: 14,
          source: "implicit",
          tags: ["tool-graph"],
        })
      }
    }

    const toPersist: Instinct[] = []
    for (const inst of candidates) {
      const { score } = this.evaluate(inst)
      const scored: Instinct = { ...inst, score, confidence: score }
      this.instincts.upsert(scored)
      toPersist.push(scored)
      this.logger.info(`Curated instinct ${scored.id} score=${score.toFixed(2)} "${scored.text.slice(0, 60)}"`)
    }

    return toPersist.filter((i) => this.evaluate(i).promote)
  }

  private synthesizeErrorFix(pair: { errorMessage: string; errorTool: string; fixTool: string; fixFile?: string }): string | null {
    const err = pair.errorMessage.slice(0, 200)
    if (err.length < 5) return null
    const fileHint = pair.fixFile ? ` in ${pair.fixFile}` : ""
    return `When ${pair.errorTool} fails with "${err}" then use ${pair.fixTool}${fileHint} to fix it. Prefer reading the file before editing and verify with tests.`
  }

  private buildToolGraphSummary(ledger: { tool: string }[]): string | null {
    if (ledger.length < 5) return null
    const counts = new Map<string, number>()
    for (const e of ledger) counts.set(e.tool, (counts.get(e.tool) ?? 0) + 1)
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 3).map(([k, v]) => `${k}(${v})`).join(" → ")
    if (top.length < 10) return null
    return `Frequent tool sequence in this session: ${top}. Consider batching independent calls and verifying file existence before operations.`
  }
}
