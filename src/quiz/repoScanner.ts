import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { glob } from "glob"
import type { RepoProfile } from "../types.js"

export async function scanRepo(repoRoot: string): Promise<RepoProfile> {
  const languages: Record<string, number> = {}
  const frameworks: string[] = []
  let packageManager: string | null = null
  let fileCount = 0
  const deps: Record<string, string> = {}

  const files = await glob("**/*", {
    cwd: repoRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "dist/**", "coverage/**", ".cache/**"],
  })
  fileCount = files.length

  const extMap: Record<string, string> = {
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

  for (const f of files) {
    const ext = f.split(".").pop()?.toLowerCase() ?? ""
    const lang = extMap[ext]
    if (lang) languages[lang] = (languages[lang] ?? 0) + 1
  }

  const pkgPath = join(repoRoot, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>
      const allDeps = {
        ...((pkg.dependencies as Record<string, string>) ?? {}),
        ...((pkg.devDependencies as Record<string, string>) ?? {}),
      }
      Object.assign(deps, allDeps)
      const depKeys = Object.keys(allDeps)
      if (depKeys.includes("next")) frameworks.push("next")
      if (depKeys.includes("react")) frameworks.push("react")
      if (depKeys.includes("vue")) frameworks.push("vue")
      if (depKeys.includes("vite")) frameworks.push("vite")
      if (depKeys.includes("express")) frameworks.push("express")
      if (depKeys.includes("fastify")) frameworks.push("fastify")
      if (depKeys.includes("@opencode-ai/plugin") || depKeys.includes("opencode")) frameworks.push("opencode")
      if (depKeys.includes("zod")) frameworks.push("zod")
      if (existsSync(join(repoRoot, "pnpm-lock.yaml"))) packageManager = "pnpm"
      else if (existsSync(join(repoRoot, "yarn.lock"))) packageManager = "yarn"
      else if (existsSync(join(repoRoot, "package-lock.json"))) packageManager = "npm"
      else packageManager = "npm"
    } catch {
      // ignore
    }
  }

  if (existsSync(join(repoRoot, "pyproject.toml")) || existsSync(join(repoRoot, "requirements.txt"))) {
    if (!frameworks.includes("python")) frameworks.push("python")
    try {
      const reqPath = join(repoRoot, "requirements.txt")
      if (existsSync(reqPath)) {
        const req = readFileSync(reqPath, "utf8")
        for (const line of req.split("\n")) {
          const name = line.split(/==|>=|<=|~=|>|</)[0]?.trim()
          if (name) deps[`py:${name}`] = line.trim()
        }
      }
    } catch {
      // ignore
    }
  }

  if (existsSync(join(repoRoot, "Cargo.toml"))) {
    frameworks.push("rust")
    if (!packageManager) packageManager = "cargo"
  }
  if (existsSync(join(repoRoot, "go.mod"))) {
    frameworks.push("go")
    if (!packageManager) packageManager = "go"
  }

  const treeSitterHint = Object.entries(languages).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (treeSitterHint) frameworks.push(`lang:${treeSitterHint}`)

  return { languages, frameworks: [...new Set(frameworks)], packageManager, fileCount, deps }
}
