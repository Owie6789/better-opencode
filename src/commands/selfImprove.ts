import { readdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { InstinctsStore } from "../stores/instinctsStore.js"
import { SkillStore } from "../stores/skillStore.js"
import { Ledger } from "../state/ledger.js"
import { SessionState } from "../state/sessionState.js"
import { Interview } from "../quiz/interview.js"
import { DriftDetector } from "../quiz/driftDetector.js"
import { scanRepo } from "../quiz/repoScanner.js"
import { Logger } from "../utils/logger.js"
import { CacheStore } from "../stores/cacheStore.js"
import type { VectorStore } from "../rag/vectorStore.js"

export type SelfImproveSubcommand = "status" | "history" | "rollback" | "tune"

export class SelfImproveCommand {
  constructor(
    private readonly instincts: InstinctsStore,
    private readonly skills: SkillStore,
    private readonly ledger: Ledger,
    private readonly session: SessionState | null,
    private readonly cache: CacheStore,
    private readonly logger: Logger = new Logger(false),
    private readonly projectRoot: string = process.cwd(),
    private readonly vectorStore?: VectorStore,
  ) {}

  async execute(sub: SelfImproveSubcommand, args: Record<string, string> = {}): Promise<string> {
    switch (sub) {
      case "status":
        return this.status()
      case "history":
        return this.history(args.slug ?? "")
      case "rollback":
        return this.rollback(args.slug ?? "", args.version ? Number(args.version) : undefined)
      case "tune":
        return this.tune()
      default:
        return this.help()
    }
  }

  private status(): string {
    const instincts = this.instincts.all()
    const top = [...instincts].sort((a, b) => b.score - a.score).slice(0, 5)
    const skills = this.skills.listT2()
    const t3 = this.skills.listT3()
    const graph = this.ledger.toolGraph().slice(0, 5).map((e) => `${e.from}→${e.to}(${e.count})`).join(", ") || "none"
    const errRate = this.ledger.errorRate().toFixed(2)
    const cacheStats = this.cache.stats()
    const sess = this.session ? `session=${this.session.id} tools=${this.session.getData().toolCallCount}` : "no active session"
    const vectorCount = this.vectorStore ? this.vectorStore.count() : 0

    return [
      "=== self-improve status ===",
      `instincts: ${instincts.length} (top: ${top.map((t) => `${t.id}:${t.score.toFixed(1)}`).join(", ") || "none"})`,
      `skills T2: ${skills.length} [${skills.map((s) => s.slug).join(", ") || "none"}]`,
      `skills T3: ${t3.length} [${t3.slice(0, 5).join(", ")}]`,
      `ledger: ${this.ledger.all().length} entries, errorRate=${errRate}, graph=${graph}`,
      `cache: mem=${cacheStats.memorySize} file=${cacheStats.fileSize}`,
      `vectorStore: ${vectorCount} chunks indexed`,
      sess,
      `frozen snapshot chars: ${this.instincts.frozenSnapshot().length}/2200`,
    ].join("\n")
  }

  private history(slug: string): string {
    if (!slug) return "Usage: /self-improve history <slug>"
    const skill = this.skills.readSkill(slug)
    if (!skill) return `Skill ${slug} not found`
    const dir = skill.historyDir
    if (!existsSync(dir)) return `No history for ${slug}`
    const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort()
    if (files.length === 0) return `No history for ${slug}`
    const lines = files.map((f) => {
      const content = readFileSync(join(dir, f), "utf8").slice(0, 200).replace(/\n/g, " ")
      return `- ${f}: ${content}...`
    })
    return [`History for ${slug} (${files.length} versions):`, ...lines].join("\n")
  }

  private rollback(slug: string, timestamp?: number): string {
    if (!slug) return "Usage: /self-improve rollback <slug> [timestamp]"
    const ok = this.skills.rollback(slug, timestamp)
    if (!ok) return `Rollback failed for ${slug} (no history?)`
    this.logger.info(`Rolled back ${slug} ${timestamp ?? "latest"}`)
    return `Rolled back ${slug} to ${timestamp ?? "latest"} version`
  }

  private async tune(): Promise<string> {
    const profile = await scanRepo(this.projectRoot)
    const interview = new Interview(this.logger)
    const questions = interview.generate(profile)
    const detector = new DriftDetector(0.3, this.logger)
    const drift = await detector.check(this.projectRoot, profile)

    const result = {
      profile,
      questions,
      answers: {} as Record<string, string>,
      generatedAt: Date.now(),
    }
    interview.saveAnswers(this.projectRoot, result)

    return [
      "=== tune: re-interview ===",
      `Repo: ${profile.frameworks.join(", ") || "generic"} files=${profile.fileCount} langs=${Object.entries(profile.languages).map(([k, v]) => `${k}:${v}`).join(", ")}`,
      `Drift: ${drift.drifted ? `YES ${drift.reason}` : "none"}`,
      `Generated ${questions.length} questions:`,
      ...questions.map((q, i) => `${i + 1}. [${q.category}] ${q.text}${q.options ? ` (options: ${q.options.join(" | ")})` : ""}`),
      "Answer via /teach or edit ~/.cache/better-opencode/interview-*.json",
    ].join("\n")
  }

  help(): string {
    return [
      "self-improve commands:",
      "  /self-improve status              — ledger, instincts, skills, cache",
      "  /self-improve history <slug>      — list versions",
      "  /self-improve rollback <slug> [ts]— restore previous",
      "  /self-improve tune                — re-scan repo + regenerate quiz",
      "  /teach <text>                     — explicit weighted instinct (3x)",
    ].join("\n")
  }

  health(): Record<string, unknown> {
    return {
      instincts: this.instincts.count(),
      skillsT2: this.skills.countT2(),
      skillsT3: this.skills.listT3().length,
      ledgerSize: this.ledger.all().length,
      errorRate: this.ledger.errorRate(),
      cache: this.cache.stats(),
      vectorStoreCount: this.vectorStore ? this.vectorStore.count() : 0,
      lastCurate: this.session?.getData().lastIdleAt ?? null,
      frozenChars: this.instincts.frozenSnapshot().length,
    }
  }
}
