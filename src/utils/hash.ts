import { createHash } from "node:crypto"

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

export function contentHash(
  fileContent: string,
  chunkerVersion: string,
  embeddingModel: string,
): string {
  return sha256(`${fileContent}::${chunkerVersion}::${embeddingModel}`)
}

export function repoHash(files: string[]): string {
  const sorted = [...files].sort().join("\n")
  return sha256(sorted).slice(0, 16)
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const x of a) if (b.has(x)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 1 : intersection / union
}
