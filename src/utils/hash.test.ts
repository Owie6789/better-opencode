import { describe, it, expect } from "vitest"
import { sha256, contentHash, repoHash, jaccardSimilarity } from "./hash.js"

describe("hash utils", () => {
  it("sha256 is deterministic", () => {
    expect(sha256("hello")).toBe(sha256("hello"))
    expect(sha256("hello")).toHaveLength(64)
  })
  it("contentHash includes versions", () => {
    const a = contentHash("file", "v1", "m1")
    const b = contentHash("file", "v2", "m1")
    expect(a).not.toBe(b)
  })
  it("repoHash sorted and truncated", () => {
    expect(repoHash(["b", "a"])).toBe(repoHash(["a", "b"]))
    expect(repoHash(["a"]).length).toBe(16)
  })
  it("jaccard edge cases", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1)
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0)
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1)
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["a"]))).toBe(0.5)
  })
})
