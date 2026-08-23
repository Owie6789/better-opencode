import type { Chunk } from "../types.js"
import type { VectorStore } from "./vectorStore.js"
import type { Embedder } from "./embedder.js"
import { Logger } from "../utils/logger.js"

export interface HybridOpts {
  kVector?: number
  kBm25?: number
  kAst?: number
  rrfK?: number
  definitionBoost?: number
  fileCoherenceBoost?: number
  limit?: number
}

function rrfScore(rank: number, k: number): number {
  return 1 / (k + rank)
}

export async function hybridSearch(
  query: string,
  vectorStore: VectorStore,
  embedder: Embedder,
  opts: HybridOpts = {},
  logger: Logger = new Logger(false),
): Promise<Array<{ chunk: Chunk; score: number }>> {
  const kVector = opts.kVector ?? 20
  const kBm25 = opts.kBm25 ?? 20
  const kAst = opts.kAst ?? 10
  const rrfK = opts.rrfK ?? 60
  const definitionBoost = opts.definitionBoost ?? 0.3
  const fileCoherenceBoost = opts.fileCoherenceBoost ?? 0.2
  const limit = opts.limit ?? 10

  const queryEmbedding = (await embedder.embed([query]))[0] ?? []

  const [denseHits, bm25Hits] = await Promise.all([
    queryEmbedding.length > 0 ? vectorStore.search(queryEmbedding, kVector) : Promise.resolve([] as Array<{ chunk: Chunk; score: number }>),
    vectorStore.bm25(query, kBm25),
  ])

  const astHits = await vectorStore.bm25(query, kAst).then((hits) =>
    hits.filter((h) => h.chunk.kind === "definition").map((h) => ({ ...h, score: h.score * 1.2 })),
  )

  const rrfMap = new Map<string, { chunk: Chunk; rrf: number; sources: string[] }>()

  function addList(list: Array<{ chunk: Chunk; score: number }>, source: string): void {
    list.forEach((hit, rank) => {
      const key = hit.chunk.id
      const existing = rrfMap.get(key)
      const contrib = rrfScore(rank + 1, rrfK)
      if (existing) {
        existing.rrf += contrib
        existing.sources.push(source)
      } else {
        rrfMap.set(key, { chunk: hit.chunk, rrf: contrib, sources: [source] })
      }
    })
  }

  addList(denseHits, "vector")
  addList(bm25Hits, "bm25")
  if (astHits.length > 0) addList(astHits, "ast")

  let merged = [...rrfMap.values()].map(({ chunk, rrf, sources }) => {
    let score = rrf
    if (chunk.kind === "definition") score += definitionBoost * rrf
    if (sources.length > 1) score += 0.05 * rrf
    return { chunk, score }
  })

  const fileCounts = new Map<string, number>()
  for (const m of merged) fileCounts.set(m.chunk.file, (fileCounts.get(m.chunk.file) ?? 0) + 1)
  merged = merged.map((m) => {
    const cnt = fileCounts.get(m.chunk.file) ?? 1
    if (cnt > 1) return { ...m, score: m.score + fileCoherenceBoost * 0.1 * Math.log(cnt) }
    return m
  })

  merged.sort((a, b) => b.score - a.score)

  const top = merged.slice(0, Math.min(limit * 5, 50))
  const reranked = await rerank(query, top, limit, logger)
  return reranked
}

async function rerank(
  _query: string,
  candidates: Array<{ chunk: Chunk; score: number }>,
  limit: number,
  logger: Logger,
): Promise<Array<{ chunk: Chunk; score: number }>> {
  void logger
  if (candidates.length <= limit) return candidates

  const scored = candidates.map((c) => {
    const defBonus = c.chunk.kind === "definition" ? 0.02 : 0
    const lengthPenalty = c.chunk.text.length > 2000 ? -0.01 : 0
    return { ...c, score: c.score + defBonus + lengthPenalty }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}
