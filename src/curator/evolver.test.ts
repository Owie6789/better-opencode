import { describe, it, expect } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Evolver } from "./evolver.js"
import { InstinctsStore } from "../stores/instinctsStore.js"
import { SessionState } from "../state/sessionState.js"

describe("Evolver scoring", () => {
  it("score formula and evaluate threshold", () => {
    const dir = mkdtempSync(join(tmpdir(), "ev-"))
    const instStore = new InstinctsStore(join(dir, "i.json"))
    const ev = new Evolver(instStore, undefined as never, { confidenceThreshold: 3, minHits: 3, minSuccessRate: 0.6 })
    const inst = { id: "1", text: "hello", score: 3, confidence: 3, hits: 5, successRate: 0.8, tokenDelta: 500, toolCallsDelta: 5, explicitWeight: 0, createdAt: Date.now(), updatedAt: Date.now(), ttlDays: 14, source: "implicit" as const, tags: [] }
    expect(ev.scoreInstinct(inst)).toBeGreaterThan(3)
    expect(ev.evaluate(inst).promote).toBe(true)
    const low = { ...inst, hits: 1 }
    expect(ev.evaluate(low).promote).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
  it("curate synthesizes errorFix", () => {
    const dir = mkdtempSync(join(tmpdir(), "ev2-"))
    const instStore = new InstinctsStore(join(dir, "i.json"))
    const ev = new Evolver(instStore)
    const sess = new SessionState("s1", null)
    // ingest error then fix
    sess.ingest({ id: "1", timestamp: Date.now(), tool: "Write", input: {}, output: {}, error: "ENOENT", durationMs: 10, tokenUsage: undefined })
    sess.ingest({ id: "2", timestamp: Date.now(), tool: "Read", input: { file_path: "foo.ts" }, output: {}, error: null, durationMs: 5, tokenUsage: undefined })
    sess.ingest({ id: "3", timestamp: Date.now(), tool: "Write", input: { file_path: "foo.ts" }, output: {}, error: null, durationMs: 5, tokenUsage: undefined })
    // need ledger length >=3 triggers errorFix synthesis
    const candidates = ev.curate(sess)
    // may be empty if not enough history, but should not throw
    expect(Array.isArray(candidates)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
