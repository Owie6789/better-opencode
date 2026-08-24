import { describe, it, expect } from "vitest"
import { Interview } from "./interview.js"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("interview", () => {
  it("generates 5-7 Q deduped", () => {
    const interview = new Interview()
    const profile = { languages: { typescript: 50 }, frameworks: ["react", "next"], packageManager: "npm", fileCount: 20, deps: { zod: "1" } }
    const qs = interview.generate(profile as never)
    expect(qs.length).toBeGreaterThanOrEqual(5)
    expect(qs.length).toBeLessThanOrEqual(7)
    const ids = new Set(qs.map((q) => q.id))
    expect(ids.size).toBe(qs.length)
  })
  it("save/load roundtrip", () => {
    const dir = mkdtempSync(join(tmpdir(), "interview-"))
    const interview = new Interview()
    const profile = { languages: { typescript: 10 }, frameworks: [], packageManager: null, fileCount: 1, deps: {} } as never
    const qs = interview.generate(profile)
    const answers: Record<string, string> = {}
    for (const q of qs) answers[q.id] = "test answer"
    const result = { profile, questions: qs, answers, generatedAt: Date.now() }
    interview.saveAnswers(dir, result)
    const loaded = interview.loadAnswers(dir)
    expect(loaded).not.toBeNull()
    expect(loaded?.answers).toEqual(answers)
    rmSync(dir, { recursive: true, force: true })
  })
})
