import type { LedgerEntry, ToolGraphEdge } from "../types.js"
import { Logger } from "../utils/logger.js"

export class Ledger {
  private entries: LedgerEntry[] = []

  constructor(private readonly logger: Logger = new Logger(false)) {}

  ingest(entry: LedgerEntry): void {
    this.entries.push(entry)
    this.logger.debug(`Ledger ingest ${entry.tool} error=${entry.error !== null}`)
  }

  all(): LedgerEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  toolGraph(): ToolGraphEdge[] {
    const map = new Map<string, number>()
    for (let i = 1; i < this.entries.length; i++) {
      const from = this.entries[i - 1]!.tool
      const to = this.entries[i]!.tool
      const key = `${from}→${to}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    const edges: ToolGraphEdge[] = []
    for (const [k, count] of map) {
      const [from, to] = k.split("→") as [string, string]
      edges.push({ from, to, count })
    }
    return edges.sort((a, b) => b.count - a.count)
  }

  toolCounts(): Map<string, number> {
    const m = new Map<string, number>()
    for (const e of this.entries) m.set(e.tool, (m.get(e.tool) ?? 0) + 1)
    return m
  }

  errorRate(): number {
    if (this.entries.length === 0) return 0
    const errs = this.entries.filter((e) => e.error !== null).length
    return errs / this.entries.length
  }

  recentErrors(limit = 5): LedgerEntry[] {
    return this.entries.filter((e) => e.error !== null).slice(-limit)
  }
}
