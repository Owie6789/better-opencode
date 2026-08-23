import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { glob } from "glob"
import type { Fingerprint, RepoProfile } from "../types.js"
import { Logger } from "../utils/logger.js"

const DEP_FILES = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "requirements.txt", "pnpm-lock.yaml", "yarn.lock", "package-lock.json"]

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

export class FingerprintStore {
  constructor(
    private readonly cacheDir: string = join(homedir(), ".cache", "better-opencode"),
    private readonly logger: Logger = new Logger(false),
  ) {}

  private fingerprintPath(repoRoot: string): string {
    const hash = sha256Hex(repoRoot).slice(0, 12)
    return join(this.cacheDir, hash, "fingerprint.json")
  }

  async compute(repoRoot: string): Promise<Fingerprint> {
    const depContents: string[] = []
    for (const depFile of DEP_FILES) {
      const p = join(repoRoot, depFile)
      if (existsSync(p)) {
        try {
          depContents.push(readFileSync(p, "utf8"))
        } catch {
          depContents.push(depFile)
        }
      }
    }
    const depsHash = sha256Hex(depContents.join("\n::\n"))

    const files = await glob("**/*.{ts,js,tsx,jsx,py,rs,go,java,json}", {
      cwd: repoRoot,
      nodir: true,
      ignore: ["node_modules/**", ".git/**", "dist/**", ".agents/**", ".claude/**", "coverage/**"],
    })

    files.sort()
    const fileListHash = sha256Hex(files.join("\n"))
    const combined = sha256Hex(`${depsHash}::${fileListHash}`)

    return {
      hash: combined,
      fileCount: files.length,
      depsHash,
      createdAt: Date.now(),
    }
  }

  load(repoRoot: string): Fingerprint | null {
    const p = this.fingerprintPath(repoRoot)
    if (!existsSync(p)) return null
    try {
      const raw = readFileSync(p, "utf8")
      const parsed = JSON.parse(raw) as Fingerprint
      return parsed
    } catch (err) {
      this.logger.warn("fingerprint load failed", err)
      return null
    }
  }

  save(repoRoot: string, fp: Fingerprint): void {
    const p = this.fingerprintPath(repoRoot)
    const dir = dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${p}.tmp`
    writeFileSync(tmp, JSON.stringify(fp, null, 2), "utf8")
    writeFileSync(p, JSON.stringify(fp, null, 2), "utf8")
    this.logger.info(`Fingerprint saved ${fp.hash.slice(0, 12)}`)
  }

  async needsRecompute(repoRoot: string, profile?: RepoProfile): Promise<boolean> {
    const prev = this.load(repoRoot)
    if (!prev) return true
    const curr = await this.compute(repoRoot)
    if (curr.hash !== prev.hash) return true
    if (profile && prev.profile) {
      const depDiff = this.jaccardDeps(prev.profile.deps, profile.deps)
      if (depDiff > 0.3) return true
    }
    return false
  }

  private jaccardDeps(a: Record<string, string>, b: Record<string, string>): number {
    const setA = new Set(Object.keys(a))
    const setB = new Set(Object.keys(b))
    if (setA.size === 0 && setB.size === 0) return 0
    let inter = 0
    for (const k of setA) if (setB.has(k)) inter++
    const union = setA.size + setB.size - inter
    return union === 0 ? 0 : 1 - inter / union
  }
}
