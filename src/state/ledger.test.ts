import { describe, it, expect } from "vitest"
import { Ledger } from "./ledger.js"

describe("Ledger", () => {
  it("ingest and all and errorRate", () => {
    const l = new Ledger()
    l.ingest({ id: "1", timestamp: Date.now(), tool: "Read", input: {}, output: {}, error: null, durationMs: 10 })
    l.ingest({ id: "2", timestamp: Date.now(), tool: "Write", input: {}, output: {}, error: "boom", durationMs: 5 })
    expect(l.all().length).toBe(2)
    expect(l.errorRate()).toBe(0.5)
    expect(l.toolCounts().get("Read")).toBe(1)
  })
  it("clear", () => {
    const l = new Ledger()
    l.ingest({ id: "1", timestamp: Date.now(), tool: "A", input: {}, output: {}, error: null, durationMs: 1 })
    l.clear()
    expect(l.all().length).toBe(0)
  })
})
