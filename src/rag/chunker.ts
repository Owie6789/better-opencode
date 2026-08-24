import { createHash } from "node:crypto"
import type { Chunk } from "../types.js"
import { Logger } from "../utils/logger.js"

const CHUNKER_VERSION = "v1-tree-regex-fallback"

export interface ChunkerOpts {
  maxTokens?: number
  overlapRatio?: number
}

export function detectLanguage(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    mjs: "javascript",
    cjs: "javascript",
  }
  return map[ext] ?? "text"
}

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)
}

function extractSymbols(content: string, language: string): Array<{ symbol: string; kind: "definition"; lineStart: number; lineEnd: number; text: string }> {
  const lines = content.split("\n")
  const results: Array<{ symbol: string; kind: "definition"; lineStart: number; lineEnd: number; text: string }> = []

  const patterns: RegExp[] = []
  if (language === "typescript" || language === "javascript") {
    patterns.push(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g)
    patterns.push(/(?:export\s+)?class\s+(\w+)/g)
    patterns.push(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g)
    patterns.push(/^\s*(?:async\s+)?(\w+)\s*\(.*\)\s*\{/gm)
  } else if (language === "python") {
    patterns.push(/def\s+(\w+)\s*\(/g)
    patterns.push(/class\s+(\w+)\s*[:\(]/g)
    patterns.push(/async def\s+(\w+)\s*\(/g)
  } else if (language === "rust") {
    patterns.push(/fn\s+(\w+)\s*\(/g)
    patterns.push(/struct\s+(\w+)/g)
    patterns.push(/impl\s+(\w+)/g)
    patterns.push(/enum\s+(\w+)/g)
  } else if (language === "go") {
    patterns.push(/func\s+(?:\(\w+ \*?\w+\)\s+)?(\w+)\s*\(/g)
    patterns.push(/type\s+(\w+)\s+struct/g)
  } else if (language === "java") {
    patterns.push(/class\s+(\w+)/g)
    patterns.push(/(?:public|private|protected)\s+\w+\s+(\w+)\s*\(/g)
  }

  for (const re of patterns) {
    let m: RegExpExecArray | null
    const clone = new RegExp(re.source, re.flags)
    while ((m = clone.exec(content)) !== null) {
      const idx = m.index
      const lineStart = content.slice(0, idx).split("\n").length
      const rawSym = m[1]
      const sym = rawSym && rawSym.trim().length > 0 ? rawSym : `chunk_${lineStart}`
      const snippetStart = Math.max(0, idx - 200)
      const snippetEnd = Math.min(content.length, idx + 800)
      const text = content.slice(snippetStart, snippetEnd).trim().slice(0, 1200)
      const lineEnd = lineStart + text.split("\n").length
      results.push({ symbol: sym, kind: "definition", lineStart, lineEnd: Math.min(lineEnd, lines.length), text })
      if (results.length > 50) break
    }
  }
  return results.slice(0, 30)
}

function chunkByTokensFallback(content: string, _language: string, maxTokens: number, overlapRatio: number): Array<{ text: string; lines: [number, number] }> {
  const approxCharsPerToken = 4
  const maxChars = maxTokens * approxCharsPerToken
  const overlapChars = Math.floor(maxChars * overlapRatio)
  const chunks: Array<{ text: string; lines: [number, number] }> = []
  let start = 0
  while (start < content.length) {
    const end = Math.min(content.length, start + maxChars)
    const slice = content.slice(start, end)
    const lineStart = content.slice(0, start).split("\n").length
    const lineEnd = content.slice(0, end).split("\n").length
    if (slice.trim().length > 20) chunks.push({ text: slice, lines: [lineStart, lineEnd] })
    if (end >= content.length) break
    start = end - overlapChars
    if (start < 0) start = 0
  }
  return chunks
}

function resolveChunkArgs(a: string, b: string): { file: string; content: string } {
  const bIsFile = /\.\w{1,5}$/.test(b.trim()) && !b.includes("\n") && b.length < 256
  const aIsFile = /\.\w{1,5}$/.test(a.trim()) && !a.includes("\n") && a.length < 256
  if (bIsFile && !aIsFile) return { file: b, content: a }
  if (aIsFile && !bIsFile) return { file: a, content: b }
  if (bIsFile && a.includes("\n")) return { file: b, content: a }
  return { file: a, content: b }
}

export function chunkFile(file: string, content: string, opts: ChunkerOpts = {}): Chunk[] {
  const resolved = resolveChunkArgs(file, content)
  const actualFile = resolved.file
  const actualContent = resolved.content
  const language = detectLanguage(actualFile)
  const maxTokens = opts.maxTokens ?? 400
  const overlapRatio = opts.overlapRatio ?? 0.2
  content = actualContent
  file = actualFile

  if (content.trim().length === 0) return []
  if (content.length > 200_000) {
    content = content.slice(0, 200_000)
  }

  const symbolChunks = extractSymbols(content, language)
  if (symbolChunks.length > 0) {
    const chunks: Chunk[] = symbolChunks.map((s) => ({
      id: `${file}:${s.symbol}:${s.lineStart}`,
      file,
      language,
      symbol: s.symbol,
      kind: "definition" as const,
      lines: [s.lineStart, s.lineEnd] as [number, number],
      hash: hashText(s.text),
      text: s.text,
      astPath: `${language}::${s.symbol}`,
    }))

    const covered = new Set(chunks.flatMap((c) => {
      const arr: number[] = []
      for (let i = c.lines[0]; i <= c.lines[1]; i++) arr.push(i)
      return arr
    }))

    const fallback = chunkByTokensFallback(content, language, maxTokens, overlapRatio)
    for (const f of fallback) {
      const mid = Math.floor((f.lines[0] + f.lines[1]) / 2)
      if (covered.has(mid)) continue
      if (f.text.length < 100) continue
      chunks.push({
        id: `${file}:chunk:${f.lines[0]}`,
        file,
        language,
        symbol: null,
        kind: "chunk",
        lines: f.lines,
        hash: hashText(f.text),
        text: f.text,
      })
      if (chunks.length > 40) break
    }
    return chunks.slice(0, 40)
  }

  const fallback = chunkByTokensFallback(content, language, maxTokens, overlapRatio)
  return fallback.map((f) => ({
    id: `${file}:chunk:${f.lines[0]}`,
    file,
    language,
    symbol: null,
    kind: "chunk" as const,
    lines: f.lines,
    hash: hashText(f.text),
    text: f.text,
  }))
}

export function getChunkerVersion(): string {
  return CHUNKER_VERSION
}

export const chunkText = chunkFile

let treeSitterInit: Promise<object | null> | null = null
let treeSitterWarned = false

function noteTreeSitterFallback(logger?: Logger): void {
  if (logger && !treeSitterWarned) {
    logger.info("tree-sitter not available, using regex fallback")
    treeSitterWarned = true
  }
}

async function loadTreeSitterModule(): Promise<Record<string, unknown> | null> {
  const mod = (await import("web-tree-sitter").catch(() => null)) as unknown as Record<string, unknown> | null
  return mod
}

async function initParser(parserCandidate: unknown): Promise<boolean> {
  const parserObj = parserCandidate as Record<string, unknown> | null
  if (parserObj && typeof parserObj.init === "function") {
    try {
      await (parserObj as { init: () => Promise<void> }).init()
    } catch {}
    return true
  }
  return false
}

async function tryLoadTreeSitter(logger?: Logger): Promise<object | null> {
  if (treeSitterInit !== null) return treeSitterInit
  try {
    const mod = await loadTreeSitterModule()
    if (!mod) {
      treeSitterInit = Promise.resolve(null)
      noteTreeSitterFallback(logger)
      return null
    }
    const Parser: unknown = mod.Parser ?? mod.default ?? mod
    const inited = await initParser(Parser)
    if (inited) {
      treeSitterInit = Promise.resolve(mod as object)
      return mod as object
    }
    const loaded: object | null = mod.Parser ? (mod as object) : null
    treeSitterInit = Promise.resolve(loaded)
    if (!loaded) noteTreeSitterFallback(logger)
    return loaded
  } catch {
    treeSitterInit = Promise.resolve(null)
    noteTreeSitterFallback(logger)
    return null
  }
}

export async function tryTreeSitterChunk(file: string, content: string, logger?: Logger): Promise<Chunk[] | null> {
  try {
    const ts = await tryLoadTreeSitter(logger)
    if (ts) {
      logger?.debug("tree-sitter parser available but grammar not bundled, using regex fallback")
      return chunkFile(file, content)
    }
    noteTreeSitterFallback(logger)
    return chunkFile(file, content)
  } catch {
    return null
  }
}

export function tryTreeSitterChunkSync(file: string, content: string, logger?: Logger): Chunk[] | null {
  try {
    if (logger && !treeSitterWarned) {
      logger.info("tree-sitter not available, using regex fallback")
      treeSitterWarned = true
    }
    return chunkFile(file, content)
  } catch {
    return null
  }
}
