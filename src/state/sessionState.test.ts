import { describe, it, expect } from "vitest"
import { SessionState } from "./sessionState.js"

describe("SessionState", () => {
  it("ingest tracks ledger and errorFix", () => {
    const s = new SessionState("id", null)
    s.ingest({ id: "1", timestamp: Date.now(), tool: "Write", input: {}, output: {}, error: "fail", durationMs: 1 })
    s.ingest({ id: "2", timestamp: Date.now(), tool: "Read", input: {}, output: {}, error: null, durationMs: 1 })
    expect(s.getLedger().length).toBe(2)
    expect(s.getErrorFixPairs().length).toBeGreaterThan(0)
  })
  it("token delta", () => {
    const s = new SessionState("id2", null)
    s.ingest({ id: "1", timestamp: Date.now(), tool: "Read", input: {}, output: {}, error: null, durationMs: 1, tokenUsage: { input: 100, output: 50, total: 150 } })
    expect(s.getData().tokenUsage.total).toBe(150)
  })
  it("promotion counter", () => {
    const s = new SessionState("id3", null)
    s.recordPromotion()
    s.recordPromotion()
    expect(s.getData().toolCallCount).toBe(0)
    // promotion tracked separately
  })
})
