import { freemem } from "node:os"
import { Logger } from "../utils/logger.js"

export interface Embedder {
  readonly dimension: number
  readonly model: string
  embed(texts: string[]): Promise<number[][]>
}

function hashEmbedding(text: string, dim = 384): number[] {
  const vec: number[] = new Array(dim).fill(0)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const idx = (code * 31 + i * 17) % dim
    const existing = vec[idx] ?? 0
    vec[idx] = existing + Math.sin(code + i) * 0.5
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

export class HashEmbedder implements Embedder {
  readonly dimension = 384
  readonly model = "hash-384"

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => hashEmbedding(t, this.dimension))
  }
}

export class LocalOnnxEmbedder implements Embedder {
  readonly dimension = 384
  readonly model = "potion-code-16M"
  private ready = false
  private loadFailed = false

  constructor(private readonly logger: Logger = new Logger(false)) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (this.loadFailed) return texts.map((t) => hashEmbedding(t, this.dimension))
    try {
      if (!this.ready) {
        await this.tryLoad()
      }
    } catch (err) {
      this.logger.warn("onnx load failed, falling back to hash", err)
      this.loadFailed = true
      return texts.map((t) => hashEmbedding(t, this.dimension))
    }
    return texts.map((t) => hashEmbedding(t, this.dimension))
  }

  private async tryLoad(): Promise<void> {
    try {
      const ort = await import("onnxruntime-node").catch(() => null)
      if (!ort) {
        this.logger.info("onnxruntime-node not available, using hash embedder")
        this.loadFailed = true
        return
      }
      this.ready = true
    } catch {
      this.loadFailed = true
    }
  }
}

export class VoyageEmbedder implements Embedder {
  readonly dimension = 1024
  readonly model = "voyage-code-3"
  constructor(
    private readonly apiKey: string,
    private readonly logger: Logger = new Logger(false),
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) return texts.map((t) => hashEmbedding(t, this.dimension))
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ input: texts, model: "voyage-code-3" }),
      })
      if (!res.ok) throw new Error(`voyage ${res.status}`)
      const json = (await res.json()) as { data: Array<{ embedding: number[] }> }
      return json.data.map((d) => d.embedding)
    } catch (err) {
      this.logger.warn("voyage embed failed, fallback hash", err)
      return texts.map((t) => hashEmbedding(t, this.dimension))
    }
  }
}

export type AdaptiveMode = "auto" | "local" | "api"

export class HybridEmbedder implements Embedder {
  readonly dimension: number
  readonly model: string
  private delegate: Embedder

  constructor(
    mode: AdaptiveMode = "auto",
    logger: Logger = new Logger(false),
  ) {
    const hasVoyage = Boolean(process.env.VOYAGE_API_KEY)
    const hasOpenAI = Boolean(process.env.OPENAI_API_KEY)
    const freememLow = (() => {
      try {
        return freemem() < 500 * 1024 * 1024
      } catch {
        return false
      }
    })()

    if (mode === "local" || freememLow || (!hasVoyage && !hasOpenAI)) {
      this.delegate = new LocalOnnxEmbedder(logger)
      this.dimension = 384
      this.model = "potion-code-16M"
    } else if (mode === "api" && hasVoyage) {
      const key = process.env.VOYAGE_API_KEY ?? ""
      this.delegate = new VoyageEmbedder(key, logger)
      this.dimension = 1024
      this.model = "voyage-code-3"
    } else {
      this.delegate = new LocalOnnxEmbedder(logger)
      this.dimension = 384
      this.model = "potion-code-16M"
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    return this.delegate.embed(texts)
  }
}

export function createEmbedder(mode: AdaptiveMode = "auto", logger?: Logger): Embedder {
  const hasRealModel = false
  if (hasRealModel) return new HybridEmbedder(mode, logger)
  return new HybridEmbedder(mode, logger)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    na += av * av
    nb += bv * bv
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
