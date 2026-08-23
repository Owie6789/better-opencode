import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import type { RepoProfile } from "../types.js"
import { Logger } from "../utils/logger.js"

export interface Question {
  id: string
  text: string
  category: "workflow" | "tech" | "preference" | "domain"
  options?: string[]
}

export interface InterviewResult {
  profile: RepoProfile
  questions: Question[]
  answers: Record<string, string>
  generatedAt: number
}

const TEMPLATE_BANK: Record<string, Question[]> = {
  typescript: [
    { id: "ts_style", text: "Which TypeScript style do you prefer for this repo?", category: "tech", options: ["strict (no any, exhaustive)", "pragmatic (some any allowed)", "minimal types"] },
    { id: "ts_tooling", text: "Preferred test runner for TS?", category: "tech", options: ["vitest", "jest", "bun test", "none"] },
  ],
  python: [
    { id: "py_style", text: "Python style preference?", category: "tech", options: ["strict typing (mypy)", "pragmatic", "scripts only"] },
  ],
  rust: [
    { id: "rust_style", text: "Rust async runtime preference?", category: "tech", options: ["tokio", "async-std", "sync only"] },
  ],
  go: [
    { id: "go_style", text: "Go framework in use?", category: "tech", options: ["std only", "gin", "fiber", "echo"] },
  ],
  react: [
    { id: "react_state", text: "State management preference?", category: "tech", options: ["zustand", "redux", "jotai", "context only"] },
  ],
  next: [
    { id: "next_deploy", text: "Deployment target?", category: "workflow", options: ["vercel", "self-hosted", "cloudflare"] },
  ],
  opencode: [
    { id: "opencode_autonomy", text: "How aggressive should self-improvement be?", category: "preference", options: ["conservative (rare)", "balanced", "aggressive (frequent)"] },
  ],
  generic: [
    { id: "workflow_git", text: "Preferred git workflow?", category: "workflow", options: ["trunk-based", "feature branches", "forking"] },
    { id: "workflow_ci", text: "CI provider?", category: "workflow", options: ["github actions", "gitlab ci", "none"] },
    { id: "pref_verbosity", text: "How verbose should the assistant be?", category: "preference", options: ["terse", "balanced", "verbose"] },
    { id: "domain_focus", text: "Primary domain focus of this repo?", category: "domain", options: ["product", "infra", "research", "mixed"] },
  ],
}

export class Interview {
  constructor(private readonly logger: Logger = new Logger(false)) {}

  generate(profile: RepoProfile): Question[] {
    const pool: Question[] = []

    for (const lang of Object.keys(profile.languages)) {
      const qs = TEMPLATE_BANK[lang]
      if (qs) pool.push(...qs)
    }
    for (const fw of profile.frameworks) {
      const base = fw.replace("lang:", "")
      const qs = TEMPLATE_BANK[base]
      if (qs) pool.push(...qs)
    }

    const genericQs = TEMPLATE_BANK.generic ?? []
    pool.push(...genericQs)

    const seen = new Set<string>()
    const deduped: Question[] = []
    for (const q of pool) {
      if (seen.has(q.id)) continue
      seen.add(q.id)
      deduped.push(q)
    }

    const top = deduped.slice(0, 7)
    if (top.length < 5) {
      const extras = (TEMPLATE_BANK.generic ?? []).filter((q) => !seen.has(q.id))
      for (const q of extras) {
        if (top.length >= 5) break
        top.push(q)
      }
    }

    const final = top.slice(0, Math.min(7, Math.max(5, top.length)))
    this.logger.info(`Interview generated ${final.length} questions for ${profile.frameworks.join(",") || "generic"}`)
    return final
  }

  saveAnswers(repoRoot: string, result: InterviewResult): void {
    const p = this.interviewPath(repoRoot)
    const dir = dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(p, JSON.stringify(result, null, 2), "utf8")
  }

  loadAnswers(repoRoot: string): InterviewResult | null {
    const p = this.interviewPath(repoRoot)
    if (!existsSync(p)) return null
    try {
      const raw = readFileSync(p, "utf8")
      return JSON.parse(raw) as InterviewResult
    } catch (err) {
      this.logger.warn("interview load failed", err)
      return null
    }
  }

  private interviewPath(repoRoot: string): string {
    const safe = repoRoot.replace(/[^a-z0-9]/gi, "_").slice(0, 40)
    return join(homedir(), ".cache", "better-opencode", `interview-${safe}.json`)
  }

  synthesizeWithLLM(_profile: RepoProfile, base: Question[]): Question[] {
    return base
  }
}
