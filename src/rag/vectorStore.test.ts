import { describe, it, expect } from "vitest"
import { MemoryVectorStore } from "./vectorStore.js"
import { HashEmbedder } from "./embedder.js"

describe("MemoryVectorStore", () => {
  it("upsert and count", async () => {
    const vs = new MemoryVectorStore()
    await vs.upsert([{ id: "a:1", file: "a.ts", language: "typescript", symbol: null, kind: "chunk", lines: [1, 10], hash: "h1", text: "hello world", embedding: [1, 0, 0] }])
    expect(vs.count()).toBe(1)
  })
  it("search cosine", async () => {
    const vs = new MemoryVectorStore()
    const emb = await new HashEmbedder().embed(["hello world"])
    const emb2 = await new HashEmbedder().embed(["unrelated"])
    await vs.upsert([
      { id: "a1", file: "a.ts", language: "ts", symbol: null, kind: "chunk", lines: [1, 1], hash: "h1", text: "hello world", embedding: emb[0] },
      { id: "a2", file: "b.ts", language: "ts", symbol: null, kind: "chunk", lines: [1, 1], hash: "h2", text: "unrelated", embedding: emb2[0] } as never,
    ])
    const q = emb[0]!
    const res = await vs.search(q, 1)
    expect(res.length).toBe(1)
    expect(res[0]!.chunk.id).toBe("a1")
  })
  it("bm25 ranks", async () => {
    const vs = new MemoryVectorStore()
    await vs.upsert([
      { id: "1", file: "a.ts", language: "ts", symbol: null, kind: "definition", lines: [1, 1], hash: "h1", text: "function foo bar" },
      { id: "2", file: "b.ts", language: "ts", symbol: null, kind: "chunk", lines: [1, 1], hash: "h2", text: "something else entirely" },
    ])
    const res = await vs.bm25("foo bar", 2)
    expect(res[0]!.chunk.id).toBe("1")
  })
})
