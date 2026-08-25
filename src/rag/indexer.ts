import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { glob } from "glob"
import { chunkFile, getChunkerVersion } from "./chunker.js"
import type { Chunk } from "../types.js"
import type { Embedder } from "./embedder.js"
import type { VectorStore } from "./vectorStore.js"
import { CacheStore } from "../stores/cacheStore.js"
import { contentHash, repoHash } from "../utils/hash.js"
import { getCacheDir } from "../config.js"
import { Logger } from "../utils/logger.js"

export interface IndexerOpts {
  repoRoot: string
  embedder: Embedder
  vectorStore: VectorStore
  cacheStore?: CacheStore
  batchSize?: number
}

export function cacheDirForRepo(repoRoot: string): string {
  return join(getCacheDir(), "index", repoHash([repoRoot]))
}

export class IndexService {
  private logger: Logger
  private chunkerVersion: string

  constructor(private readonly opts: IndexerOpts, logger: Logger = new Logger(false)) {
    this.logger = logger.child("indexer")
    this.chunkerVersion = getChunkerVersion()
  }

  async index(): Promise<{ indexed: number; skipped: number; chunks: number; repoHash: string }> {
    const { repoRoot, embedder, vectorStore, cacheStore } = this.opts
    const batchSize = this.opts.batchSize ?? 32

    const files = await glob("**/*.{ts,js,tsx,jsx,mjs,cjs,py,rs,go,java}", {
      cwd: repoRoot,
      nodir: true,
      ignore: ["node_modules/**", ".git/**", "dist/**", ".agents/**", ".claude/**", "coverage/**", ".cache/**"],
    })

    const rHash = repoHash([repoRoot])
    let indexed = 0
    let skipped = 0
    const allChunks: Chunk[] = []

    for (const rel of files) {
      const abs = join(repoRoot, rel)
      if (!existsSync(abs)) continue
      let content: string
      try {
        content = readFileSync(abs, "utf8")
      } catch {
        skipped++
        continue
      }
      if (content.length < 10) {
        skipped++
        continue
      }
      if (content.length > 500_000) content = content.slice(0, 500_000)

      const hash = contentHash(content, this.chunkerVersion, embedder.model)
      const cacheKey = `${rHash.slice(0, 8)}:${hash}`
      if (cacheStore?.has(cacheKey)) {
        const cached = cacheStore.get<Chunk[]>(cacheKey)
        if (cached && cached.length > 0) {
          allChunks.push(...cached)
          skipped++
          continue
        }
      }

      const chunks = chunkFile(rel, content)
      if (chunks.length === 0) {
        skipped++
        continue
      }
      if (cacheStore) cacheStore.set(cacheKey, chunks)
      allChunks.push(...chunks)
      indexed++
    }

    if (allChunks.length === 0) {
      this.logger.info(`No chunks to index (files=${files.length} skipped=${skipped})`)
      return { indexed, skipped, chunks: 0, repoHash: rHash }
    }

    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize)
      const embeddings = await embedder.embed(batch.map((c) => c.text.slice(0, 2000)))
      batch.forEach((c, idx) => {
        c.embedding = embeddings[idx] ?? []
      })
    }

    await vectorStore.upsert(allChunks)
    this.markIndexed(repoRoot)
    this.logger.info(`Indexed ${indexed} files, ${allChunks.length} chunks (skipped ${skipped}) hash=${rHash.slice(0, 8)}`)
    return { indexed, skipped, chunks: allChunks.length, repoHash: rHash }
  }

  private markIndexed(repoRoot: string): void {
    try {
      const dir = cacheDirForRepo(repoRoot)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, ".indexed"), new Date().toISOString(), "utf8")
    } catch (err) {
      this.logger.warn("failed to write index marker", err)
    }
  }

  async updateFile(repoRoot: string, relPath: string): Promise<number> {
    const abs = join(repoRoot, relPath)
    if (!existsSync(abs)) return 0
    const content = readFileSync(abs, "utf8")
    const chunks = chunkFile(relPath, content)
    if (chunks.length === 0) return 0
    const embeddings = await this.opts.embedder.embed(chunks.map((c) => c.text.slice(0, 2000)))
    chunks.forEach((c, idx) => {
      c.embedding = embeddings[idx] ?? []
    })
    await this.opts.vectorStore.upsert(chunks)
    return chunks.length
  }
}
