import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import matter from "gray-matter"
import { type Skill, type SkillFrontmatter } from "../types.js"
import { Logger } from "../utils/logger.js"
import { sha256 } from "../utils/hash.js"

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
}

export class SkillStore {
  constructor(
    private readonly projectRoot: string = process.cwd(),
    private readonly logger: Logger = new Logger(false),
  ) {}

  private t2Dir(slug: string): string {
    return join(this.projectRoot, ".agents", "skills", slug)
  }

  private t2MirrorDir(slug: string): string {
    return join(this.projectRoot, ".claude", "skills", slug)
  }

  private t3Dir(slug: string): string {
    return join(homedir(), ".config", "opencode", "skills-library", slug)
  }

  listT2(): Skill[] {
    const base = join(this.projectRoot, ".agents", "skills")
    if (!existsSync(base)) return []
    const slugs = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    const out: Skill[] = []
    for (const slug of slugs) {
      const s = this.readSkill(slug)
      if (s) out.push(s)
    }
    return out
  }

  listT3(): string[] {
    const base = join(homedir(), ".config", "opencode", "skills-library")
    if (!existsSync(base)) return []
    return readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  }

  readSkill(slug: string): Skill | null {
    const skillPath = join(this.t2Dir(slug), "SKILL.md")
    if (!existsSync(skillPath)) return null
    try {
      const raw = readFileSync(skillPath, "utf8")
      const parsed = matter(raw)
      const fm = parsed.data as SkillFrontmatter
      return {
        slug,
        frontmatter: {
          name: fm.name ?? slug,
          description: fm.description ?? "",
          "auto-generated": fm["auto-generated"] ?? true,
          version: fm.version ?? 1,
          confidence: fm.confidence ?? 3,
          promotedAt: fm.promotedAt ?? Date.now(),
          sourceInstinctId: fm.sourceInstinctId,
          tags: fm.tags ?? [],
        },
        body: parsed.content.trim(),
        pathT2: skillPath,
        pathMirror: join(this.t2MirrorDir(slug), "SKILL.md"),
        historyDir: join(this.t2Dir(slug), "history"),
      }
    } catch (err) {
      this.logger.warn(`Failed to read skill ${slug}`, err)
      return null
    }
  }

  promote(params: {
    instinctId: string
    text: string
    confidence: number
    tags?: string[]
  }): Skill {
    const slug = slugify(params.text.slice(0, 40)) + "-" + sha256(params.instinctId).slice(0, 6)
    const existing = this.readSkill(slug)
    const version = existing ? existing.frontmatter.version + 1 : 1

    const frontmatter: SkillFrontmatter = {
      name: slug,
      description: params.text.slice(0, 120),
      "auto-generated": true,
      version,
      confidence: params.confidence,
      promotedAt: Date.now(),
      sourceInstinctId: params.instinctId,
      tags: params.tags ?? [],
    }

    const body = `# ${slug}\n\n${params.text}\n\n---\n*Auto-generated from instinct ${params.instinctId} at ${new Date().toISOString()}*\n`
    const fileContent = matter.stringify(body, frontmatter as unknown as Record<string, unknown>)

    this.writeT2(slug, fileContent, existing?.pathT2 ? readFileSync(existing.pathT2, "utf8") : null)

    return {
      slug,
      frontmatter,
      body,
      pathT2: join(this.t2Dir(slug), "SKILL.md"),
      pathMirror: join(this.t2MirrorDir(slug), "SKILL.md"),
      historyDir: join(this.t2Dir(slug), "history"),
    }
  }

  private writeT2(slug: string, content: string, previousContent: string | null): void {
    const t2Path = join(this.t2Dir(slug), "SKILL.md")
    const mirrorPath = join(this.t2MirrorDir(slug), "SKILL.md")

    if (previousContent !== null) {
      const historyDir = join(this.t2Dir(slug), "history")
      if (!existsSync(historyDir)) mkdirSync(historyDir, { recursive: true })
      const histPath = join(historyDir, `${Date.now()}.md`)
      writeFileSync(histPath, previousContent, "utf8")
    }

    for (const p of [t2Path, mirrorPath]) {
      const dir = dirname(p)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmp = `${p}.tmp`
      writeFileSync(tmp, content, "utf8")
      writeFileSync(p, content, "utf8")
    }
    this.logger.info(`Promoted skill ${slug} to T2 + mirror`)
  }

  archiveToT3(slug: string): boolean {
    const skill = this.readSkill(slug)
    if (!skill) return false
    if (skill.frontmatter["auto-generated"] !== true) {
      this.logger.warn(`Refusing to archive non-auto-generated skill ${slug}`)
      return false
    }
    const t3Path = join(this.t3Dir(slug), "SKILL.md")
    const dir = dirname(t3Path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const raw = readFileSync(skill.pathT2, "utf8")
    writeFileSync(t3Path, raw, "utf8")
    this.logger.info(`Archived ${slug} to T3`)
    return true
  }

  rollback(slug: string, timestamp?: number): boolean {
    const historyDir = join(this.t2Dir(slug), "history")
    if (!existsSync(historyDir)) return false
    const files = readdirSync(historyDir).filter((f) => f.endsWith(".md")).sort()
    if (files.length === 0) return false
    let target: string
    if (timestamp) {
      target = files.find((f) => f.startsWith(String(timestamp))) ?? files[files.length - 1]!
    } else {
      target = files[files.length - 1]!
    }
    const histContent = readFileSync(join(historyDir, target), "utf8")
    const t2Path = join(this.t2Dir(slug), "SKILL.md")
    const mirrorPath = join(this.t2MirrorDir(slug), "SKILL.md")
    for (const p of [t2Path, mirrorPath]) {
      const dir = dirname(p)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(p, histContent, "utf8")
    }
    this.logger.info(`Rolled back ${slug} to ${target}`)
    return true
  }

  isAllowedToPromote(slug: string): boolean {
    const skill = this.readSkill(slug)
    if (!skill) return true
    return skill.frontmatter["auto-generated"] === true
  }

  countT2(): number {
    return this.listT2().length
  }
}
