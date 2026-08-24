import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { ConfigSchema, type PluginConfig } from "./types.js"

const DEFAULTS: PluginConfig = ConfigSchema.parse({})

function readJsonIfExists(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {}
    const raw = readFileSync(path, "utf8")
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

function envOverrides(): Partial<PluginConfig> {
  const out: Record<string, unknown> = {}
  if (process.env.BETTER_OPENCODE_ENABLED !== undefined)
    out.enabled = process.env.BETTER_OPENCODE_ENABLED === "true"
  if (process.env.BETTER_OPENCODE_THRESHOLD !== undefined)
    out.confidenceThreshold = Number(process.env.BETTER_OPENCODE_THRESHOLD)
  if (process.env.BETTER_OPENCODE_MAX_SKILLS !== undefined)
    out.maxSkillsPerSession = Number(process.env.BETTER_OPENCODE_MAX_SKILLS)
  if (process.env.BETTER_OPENCODE_VECTOR_STORE !== undefined)
    out.vectorStore = process.env.BETTER_OPENCODE_VECTOR_STORE
  if (process.env.BETTER_OPENCODE_ADAPTIVE_COMPUTE !== undefined)
    out.adaptiveCompute = process.env.BETTER_OPENCODE_ADAPTIVE_COMPUTE
  return out as Partial<PluginConfig>
}

export function getConfig(projectRoot?: string): PluginConfig {
  const globalPath = join(homedir(), ".config", "opencode", "config.json")
  const projectPath = projectRoot ? join(projectRoot, "opencode.json") : join(process.cwd(), "opencode.json")

  const globalJson = readJsonIfExists(globalPath)
  const projectJson = readJsonIfExists(projectPath)

  const globalSelf =
    (globalJson.selfImproving as Record<string, unknown>) ??
    (globalJson.plugins as Record<string, unknown>)?.selfImproving ??
    {}
  const projectSelf =
    (projectJson.selfImproving as Record<string, unknown>) ??
    (projectJson.plugins as Record<string, unknown>)?.selfImproving ??
    (projectJson.plugin as unknown) ??
    {}

  const merged: Record<string, unknown> = {
    ...DEFAULTS,
    ...(globalSelf as Record<string, unknown>),
    ...(projectSelf as Record<string, unknown>),
    ...envOverrides(),
  }

  const parsed = ConfigSchema.safeParse(merged)
  if (!parsed.success) {
    console.warn("[better-opencode] config parse failed, using defaults", parsed.error.flatten())
    return DEFAULTS
  }
  return parsed.data
}

export function getCacheDir(repoHash?: string): string {
  const base = join(homedir(), ".cache", "better-opencode")
  if (repoHash) return join(base, repoHash)
  return base
}

export function getInstinctsPath(): string {
  return join(getCacheDir(), "instincts.json")
}

export function getSkillsLibraryDir(): string {
  return join(homedir(), ".config", "opencode", "skills-library")
}
