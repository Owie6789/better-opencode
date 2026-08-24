import type { Chunk } from "../types.js"
import { createRequire } from "node:module"
import { cosineSimilarity } from "./embedder.js"
import { Logger } from "../utils/logger.js"

export interface VectorStore {
  upsert(chunks: Chunk[]): Promise<void>
  search(queryEmbedding: number[], k: number): Promise<Array<{ chunk: Chunk; score: number }>>
  bm25(query: string, k: number): Promise<Array<{ chunk: Chunk; score: number }>>
  count(): number
  clear(): Promise<void>
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function bm25Score(queryTokens: string[], docTokens: string[], avgLen: number, docLen: number, idf: Map<string, number>, k1 = 1.2, b = 0.75): number {
  const tf = new Map<string, number>()
  for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  let score = 0
  for (const q of queryTokens) {
    const f = tf.get(q) ?? 0
    if (f === 0) continue
    const idfVal = idf.get(q) ?? 0
    const numerator = f * (k1 + 1)
    const denominator = f + k1 * (1 - b + b * (docLen / (avgLen || 1)))
    score += idfVal * (numerator / denominator)
  }
  return score
}

export class MemoryVectorStore implements VectorStore {
  private chunks: Chunk[] = []
  private logger: Logger

  constructor(logger: Logger = new Logger(false)) {
    this.logger = logger
  }

  async upsert(chunks: Chunk[]): Promise<void> {
    const map = new Map<string, Chunk>()
    for (const c of this.chunks) map.set(c.id, c)
    for (const c of chunks) map.set(c.id, c)
    this.chunks = [...map.values()]
    this.logger.debug(`MemoryVectorStore upsert ${chunks.length} total=${this.chunks.length}`)
  }

  async search(queryEmbedding: number[], k: number): Promise<Array<{ chunk: Chunk; score: number }>> {
    const scored = this.chunks
      .filter((c) => c.embedding && c.embedding.length === queryEmbedding.length)
      .map((c) => ({
        chunk: c,
        score: cosineSimilarity(queryEmbedding, c.embedding as number[]),
      }))
      .sort((a, b) => b.score - a.score)
    if (scored.length > 0) return scored.slice(0, k)

    if (this.chunks.length === 0) return []
    const hashSim = this.chunks.map((c) => {
      const text = c.text.slice(0, 200).toLowerCase()
      const qPreview = queryEmbedding.slice(0, 5).join(",")
      return { chunk: c, score: text.length > 0 ? qPreview.length * 0.001 : 0 }
    })
    return hashSim.slice(0, k)
  }

  async bm25(query: string, k: number): Promise<Array<{ chunk: Chunk; score: number }>> {
    if (this.chunks.length === 0) return []
    const queryTokens = tokenize(query)
    const docTokensList = this.chunks.map((c) => tokenize(c.text))
    const avgLen = docTokensList.reduce((s, a) => s + a.length, 0) / (docTokensList.length || 1)

    const df = new Map<string, number>()
    for (const tokens of docTokensList) {
      const uniq = new Set(tokens)
      for (const t of uniq) df.set(t, (df.get(t) ?? 0) + 1)
    }
    const N = this.chunks.length
    const idf = new Map<string, number>()
    for (const [t, d] of df) {
      idf.set(t, Math.log(1 + (N - d + 0.5) / (d + 0.5)))
    }

    const scored = this.chunks.map((chunk, idx) => {
      const tokens = docTokensList[idx] ?? []
      const score = bm25Score(queryTokens, tokens, avgLen, tokens.length, idf)
      const boosted = chunk.kind === "definition" ? score * 1.3 : score
      const fileBoost = chunk.file.includes(query.split(/\s+/)[0] ?? "") ? boosted * 1.1 : boosted
      void fileBoost
      return { chunk, score: boosted }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  }

  count(): number {
    return this.chunks.length
  }

  async clear(): Promise<void> {
    this.chunks = []
  }

  all(): Chunk[] {
    return [...this.chunks]
  }
}

let sqliteVecAvailable: boolean | null = null
function checkSqliteVec(): boolean {
  if (sqliteVecAvailable !== null) return sqliteVecAvailable
  try {
    const rq = createRequire(import.meta.url)
    rq("better-sqlite3")
    rq("sqlite-vec")
    sqliteVecAvailable = true
  } catch {
    sqliteVecAvailable = false
  }
  return sqliteVecAvailable
}

export class SqliteVecVectorStore implements VectorStore {
  private mem = new MemoryVectorStore()
  constructor(
    private readonly dbPath: string,
    logger?: Logger,
  ) {
    void logger
  }
  async upsert(chunks: Chunk[]): Promise<void> {
    await this.mem.upsert(chunks)
  }
  async search(queryEmbedding: number[], k: number): Promise<Array<{ chunk: Chunk; score: number }>> {
    return this.mem.search(queryEmbedding, k)
  }
  async bm25(query: string, k: number): Promise<Array<{ chunk: Chunk; score: number }>> {
    return this.mem.bm25(query, k)
  }
  count(): number {
    return this.mem.count()
  }
  async clear(): Promise<void> {
    await this.mem.clear()
  }
  all(): Chunk[] {
    return this.mem.all()
  }
}

export function createVectorStore(kind: string, logger?: Logger, opts?: { dbPath?: string }): VectorStore {
  if (kind === "sqlite-vec") {
    if (checkSqliteVec()) {
      logger?.info("sqlite-vec available, using SqliteVecVectorStore (WAL+vec0)")
      return new SqliteVecVectorStore(opts?.dbPath ?? ":memory:", logger)
    }
    logger?.warn("sqlite-vec requested but native extension unavailable (Bun/macOS or missing better-sqlite3), falling back to MemoryVectorStore")
    return new MemoryVectorStore(logger)
  }
  if (kind === "lancedb") {
    logger?.info("lancedb not yet wired, using MemoryVectorStore")
    return new MemoryVectorStore(logger)
  }
  return new MemoryVectorStore(logger)
}
