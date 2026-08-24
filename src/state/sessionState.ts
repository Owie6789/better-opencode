import type { LedgerEntry, SessionStateData, ErrorFixPair } from "../types.js"

export class SessionState {
  private data: SessionStateData
  private consecutiveSkills = 0
  private sessionStart: number

  constructor(id: string, parentId: string | null = null) {
    this.sessionStart = Date.now()
    this.data = {
      id,
      parentId,
      isSubAgent: parentId !== null,
      ledger: [],
      toolCallCount: 0,
      tokenUsage: { input: 0, output: 0, total: 0 },
      fileEdits: [],
      errors: [],
      createdAt: Date.now(),
      lastIdleAt: null,
    }
  }

  get id(): string {
    return this.data.id
  }

  get parentId(): string | null {
    return this.data.parentId
  }

  get isSubAgent(): boolean {
    return this.data.isSubAgent
  }

  ingest(entry: LedgerEntry): void {
    this.data.ledger.push(entry)
    this.data.toolCallCount += 1
    if (entry.tokenUsage) {
      this.data.tokenUsage.input += entry.tokenUsage.input
      this.data.tokenUsage.output += entry.tokenUsage.output
      this.data.tokenUsage.total += entry.tokenUsage.total
    }
    if (entry.error) {
      this.data.errors.push({ tool: entry.tool, error: entry.error, fixed: false })
    } else {
      const lastError = [...this.data.errors].reverse().find((e) => !e.fixed)
      if (lastError && this.isFixTool(entry.tool)) {
        lastError.fixed = true
        ;(lastError as unknown as Record<string, unknown>).fixedAt = entry.timestamp
      }
    }
    if (this.isEditTool(entry.tool)) {
      const file = (entry.input as Record<string, unknown>)?.file_path as string | undefined
      if (file) this.data.fileEdits.push(file)
    }
  }

  private isFixTool(tool: string): boolean {
    return ["Edit", "Write", "Bash", "apply_patch", "Read"].includes(tool)
  }

  private isEditTool(tool: string): boolean {
    return ["Edit", "Write", "apply_patch"].includes(tool)
  }

  markIdle(): void {
    this.data.lastIdleAt = Date.now()
  }

  canPromote(maxPerSession: number): boolean {
    return this.consecutiveSkills < maxPerSession
  }

  recordPromotion(): void {
    this.consecutiveSkills += 1
  }

  resetPromotionCount(): void {
    this.consecutiveSkills = 0
  }

  getPromotionCount(): number {
    return this.consecutiveSkills
  }

  getLedger(): LedgerEntry[] {
    return [...this.data.ledger]
  }

  getErrors(): SessionStateData["errors"] {
    return [...this.data.errors]
  }

  getData(): SessionStateData {
    return { ...this.data, ledger: [...this.data.ledger], fileEdits: [...this.data.fileEdits], errors: [...this.data.errors] }
  }

  getErrorFixPairs(): ErrorFixPair[] {
    const pairs: ErrorFixPair[] = []
    const ledger = this.data.ledger
    for (let i = 0; i < ledger.length; i++) {
      const entry = ledger[i]!
      if (!entry.error) continue
      const fixIdx = ledger.findIndex((e, idx) => idx > i && !e.error && this.isFixTool(e.tool))
      if (fixIdx !== -1) {
        const fix = ledger[fixIdx]!
        pairs.push({
          errorTool: entry.tool,
          errorMessage: entry.error,
          fixTool: fix.tool,
          fixFile: (fix.input as Record<string, unknown>)?.file_path as string | undefined,
          latencyMs: fix.timestamp - entry.timestamp,
          timestamp: entry.timestamp,
        })
      }
    }
    return pairs
  }

  tokenDelta(prevTotal: number): number {
    return this.data.tokenUsage.total - prevTotal
  }

  toolCallsDelta(prevCount: number): number {
    return this.data.toolCallCount - prevCount
  }

  toJSON(): SessionStateData {
    return this.getData()
  }

  static fromData(data: SessionStateData): SessionState {
    const s = new SessionState(data.id, data.parentId)
    s.data = { ...data }
    return s
  }
}
