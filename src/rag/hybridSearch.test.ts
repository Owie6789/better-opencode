import { describe, it, expect } from "vitest"
import { hybridSearch } from "./hybridSearch.js"
import { MemoryVectorStore } from "./vectorStore.js"
import { HashEmbedder } from "./embedder.js"

describe("hybridSearch RRF", () => {
  it("returns ranked results", async () => {
    const vs = new MemoryVectorStore()
    const embedder = new HashEmbedder()
    const texts = ["function calculate sum", "hello world unrelated", "calculate sum function"]
    const embeddings = await embedder.embed(texts)
    await vs.upsert(texts.map((t, i) => ({ id: `id${i}`, file: `f${i}.ts`, language: "ts", symbol: i === 0 ? "calculate" : null, kind: i === 0 ? "definition" : "chunk", lines: [1, 1] as [number, number], hash: `h${i}`, text: t, embedding: embeddings[i] })))
    const hits = await hybridSearch("calculate sum", vs, embedder, { limit: 2, rrfK: 60 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThanOrEqual(2)
  })
})
