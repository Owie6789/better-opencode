import { describe, it, expect } from "vitest"
import { chunkText, detectLanguage, hashText, getChunkerVersion } from "./chunker.js"

describe("chunker", () => {
  it("detectLanguage by extension", () => {
    expect(detectLanguage("a.ts")).toBe("typescript")
    expect(detectLanguage("a.py")).toBe("python")
    expect(detectLanguage("a.go")).toBe("go")
    expect(detectLanguage("a.rs")).toBe("rust")
    expect(detectLanguage("noext")).toBe("text")
  })
  it("hashText deterministic", () => {
    expect(hashText("hello")).toBe(hashText("hello"))
    expect(hashText("a")).not.toBe(hashText("b"))
  })
  it("version string exists", () => {
    expect(getChunkerVersion().length).toBeGreaterThan(0)
  })
  it("chunks single function", () => {
    const src = `function foo() { return 1; }\nfunction bar() { return 2; }`
    const chunks = chunkText(src, "test.ts")
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks.some((c) => c.symbol === "foo")).toBe(true)
  })
  it("fallback token chunking", () => {
    const long = Array.from({ length: 1000 }, (_, i) => `token${i}`).join(" ")
    const chunks = chunkText(long, "big.txt")
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.lines[0]).toBe(1)
  })
  it("python def extraction", () => {
    const py = `def hello():\n  pass\ndef world():\n  pass`
    const chunks = chunkText(py, "x.py")
    expect(chunks.some((c) => c.symbol === "hello")).toBe(true)
  })
})
