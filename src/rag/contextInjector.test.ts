import { describe, it, expect } from "vitest"
import { selectForInjection, estimateTokens } from "./contextInjector.js"

describe("contextInjector", () => {
  it("estimateTokens len/4", () => {
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("a".repeat(400))).toBe(100)
  })
  it("selectForInjection respects budget", () => {
    const hits = [
      { chunk: { id: "1", file: "a.ts", language: "ts", symbol: null, kind: "chunk" as const, lines: [1, 1] as [number, number], hash: "h", text: "x".repeat(2000) }, score: 0.9, source: "vector" as const },
      { chunk: { id: "2", file: "b.ts", language: "ts", symbol: null, kind: "chunk" as const, lines: [1, 1] as [number, number], hash: "h2", text: "y".repeat(2000) }, score: 0.8, source: "bm25" as const },
    ]
    const out = selectForInjection(hits, 500)
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThan(5000)
  })
  it("empty hits returns empty", () => {
    expect(selectForInjection([], 4000)).toBe("")
  })
})
