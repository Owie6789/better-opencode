import type { Chunk } from "../types.js"

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function selectForInjection(
  reranked: Array<{ chunk: Chunk; score: number }>,
  tokenBudget = 4000,
): string {
  if (reranked.length === 0) return ""

  const header = "<retrieved>\n"
  const footer = "\n</retrieved>"
  let used = estimateTokens(header + footer)
  const lines: string[] = [header.trim()]

  for (const { chunk, score } of reranked) {
    const entry = `<!-- ${chunk.file}:${chunk.lines[0]} score=${score.toFixed(3)} ${chunk.symbol ?? "chunk"} -->\n${chunk.text.slice(0, 1200)}\n---`
    const tokens = estimateTokens(entry)
    if (used + tokens > tokenBudget) break
    lines.push(entry)
    used += tokens
  }

  if (lines.length === 1) return ""
  lines.push(footer.trim())
  return lines.join("\n\n")
}

export function formatChunkForPrompt(chunk: Chunk, score: number): string {
  return `[${chunk.file}:${chunk.lines[0]}-${chunk.lines[1]} ${chunk.kind} ${score.toFixed(2)}]\n${chunk.text}`
}
