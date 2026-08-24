import { z } from "zod"

export const InstinctSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(4000),
  score: z.number(),
  confidence: z.number().min(0).max(10),
  hits: z.number().int().min(0),
  successRate: z.number().min(0).max(1),
  tokenDelta: z.number().int(),
  toolCallsDelta: z.number().int().default(0),
  explicitWeight: z.number().min(0).default(0),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  ttlDays: z.number().int().min(1).default(14),
  source: z.enum(["implicit", "explicit", "llm", "imported"]).default("implicit"),
  tags: z.array(z.string()).default([]),
})

export type Instinct = z.infer<typeof InstinctSchema>

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  "auto-generated": z.boolean().default(true),
  version: z.number().int().min(1).default(1),
  confidence: z.number().min(0).max(10),
  promotedAt: z.number().int(),
  sourceInstinctId: z.string().optional(),
  tags: z.array(z.string()).default([]),
})

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

export interface Skill {
  slug: string
  frontmatter: SkillFrontmatter
  body: string
  pathT2: string
  pathMirror: string
  historyDir: string
}

export interface Chunk {
  id: string
  file: string
  language: string
  symbol: string | null
  kind: "definition" | "usage" | "chunk"
  lines: [number, number]
  hash: string
  text: string
  embedding?: number[]
  astPath?: string
}

export interface Fingerprint {
  hash: string
  fileCount: number
  depsHash: string
  createdAt: number
  profile?: RepoProfile
}

export interface RepoProfile {
  languages: Record<string, number>
  frameworks: string[]
  packageManager: string | null
  fileCount: number
  deps: Record<string, string>
}

export interface LedgerEntry {
  id: string
  timestamp: number
  tool: string
  input: unknown
  output: unknown
  error: string | null
  durationMs: number
  tokenUsage?: { input: number; output: number; total: number }
}

export interface SessionStateData {
  id: string
  parentId: string | null
  isSubAgent: boolean
  ledger: LedgerEntry[]
  toolCallCount: number
  tokenUsage: { input: number; output: number; total: number }
  fileEdits: string[]
  errors: Array<{ tool: string; error: string; fixed: boolean; fixedAt?: number }>
  createdAt: number
  lastIdleAt: number | null
}

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  confidenceThreshold: z.number().min(0).max(10).default(3),
  maxSkillsPerSession: z.number().int().min(1).max(20).default(5),
  maxInstincts: z.number().int().min(10).max(1000).default(200),
  ttlDays: z.number().int().min(1).max(365).default(14),
  vectorStore: z.enum(["sqlite-vec", "lancedb", "memory"]).default("memory"),
  embeddingModel: z.string().default("potion-code-16M"),
  ragTokenBudget: z.number().int().min(500).max(16000).default(4000),
  systemBudget: z.number().int().min(500).max(8000).default(2200),
  adaptiveCompute: z.enum(["auto", "local", "api"]).default("auto"),
  fts5SnapshotChars: z.number().int().default(2200),
  fts5WorkingChars: z.number().int().default(1375),
  driftCheckDays: z.number().int().default(7),
  driftThreshold: z.number().min(0).max(1).default(0.3),
})

export type PluginConfig = z.infer<typeof ConfigSchema>

export interface ToolGraphEdge {
  from: string
  to: string
  count: number
}

export interface ErrorFixPair {
  errorTool: string
  errorMessage: string
  fixTool: string
  fixFile?: string
  latencyMs: number
  timestamp: number
}
