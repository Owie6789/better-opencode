import { describe, it, expect } from "vitest"
import { computeDrift, needsReinterview } from "./driftDetector.js"

describe("driftDetector", () => {
  it("no drift when same", () => {
    const cur = { hash: "abc", fileCount: 10, depsHash: "d1", createdAt: Date.now(), profile: { languages: { ts: 10 }, frameworks: ["react"], packageManager: "npm", fileCount: 10, deps: { a: "1" } } }
    const prev = structuredClone(cur)
    const drift = computeDrift(prev as never, cur as never)
    expect(drift.drifted).toBe(false)
  })
  it("drift when deps changed", () => {
    const prev = { hash: "a", fileCount: 10, depsHash: "d1", createdAt: Date.now(), profile: { languages: { ts: 10 }, frameworks: [], packageManager: "npm", fileCount: 10, deps: { a: "1", b: "1" } } }
    const cur = { hash: "b", fileCount: 10, depsHash: "d2", createdAt: Date.now(), profile: { languages: { ts: 10 }, frameworks: [], packageManager: "npm", fileCount: 10, deps: { a: "2", c: "1", d: "1" } } }
    const drift = computeDrift(prev as never, cur as never)
    expect(drift.depsDiff).toBeGreaterThan(0)
  })
  it("needsReinterview true when drifted and stale", () => {
    const drifted = { drifted: true, depsDiff: 0.5, fileDelta: 0.3, hashChanged: true, prevHash: "a", curHash: "b" }
    expect(needsReinterview(drifted as never, Date.now() - 8 * 24 * 60 * 60 * 1000, 7)).toBe(true)
  })
})
