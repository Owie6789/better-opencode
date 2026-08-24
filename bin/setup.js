#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, "..")
const argSet = new Set(process.argv.slice(2))
const isGlobal = argSet.has("--global") || argSet.has("-g")
const shouldWriteConfig = !argSet.has("--no-config")

function findCommandsDir() {
  const candidates = [join(pkgRoot, "src", "commands"), join(pkgRoot, "dist", "commands"), join(pkgRoot, "commands")]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

function syncCommands(targetDir) {
  const srcDir = findCommandsDir()
  if (!srcDir) {
    console.warn(`[better-opencode] no commands source found under ${pkgRoot}`)
    return 0
  }
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  const files = readdirSync(srcDir).filter((f) => f.endsWith(".md"))
  let copied = 0
  for (const f of files) {
    const src = join(srcDir, f)
    const dest = join(targetDir, f)
    try {
      copyFileSync(src, dest)
      copied++
    } catch (e) {
      console.warn(`[better-opencode] copy failed ${f}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return copied
}

function readConfigJson(configPath) {
  let raw
  try {
    raw = readFileSync(configPath, "utf8")
  } catch (e) {
    console.error(`[better-opencode] failed to read ${configPath}: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    console.error(`[better-opencode] invalid JSON in ${configPath}: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) { // NOSONAR S3403 null check required
    console.error(`[better-opencode] invalid config in ${configPath}: expected JSON object`)
    process.exit(1)
  }
  return parsed
}

function resolvePluginsEntry(json) {
  if (Array.isArray(json.plugin)) return { plugins: json.plugin, arrKey: "plugin" }
  if (Array.isArray(json.plugins)) return { plugins: json.plugins, arrKey: "plugins" }
  if (json.plugin !== undefined || json.plugins !== undefined) {
    console.error(`[better-opencode] invalid config: "plugin" must be an array`)
    process.exit(1)
  }
  return { plugins: [], arrKey: "plugin" }
}

function ensurePluginInConfig(configPath) {
  if (!shouldWriteConfig) return false
  let json = {}
  if (existsSync(configPath)) json = readConfigJson(configPath)
  const { plugins, arrKey } = resolvePluginsEntry(json)
  if (plugins.includes("better-opencode")) return false
  plugins.push("better-opencode")
  json[arrKey] = plugins
  const dir = dirname(configPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(json, null, 2) + "\n", "utf8")
  return true
}

function main() {
  const cwd = process.cwd()
  let targetCommandsDir
  let configPath
  if (isGlobal) {
    targetCommandsDir = join(homedir(), ".config", "opencode", "commands")
    configPath = join(homedir(), ".config", "opencode", "config.json")
    console.log("[better-opencode] installing globally")
  } else {
    targetCommandsDir = join(cwd, ".opencode", "commands")
    configPath = join(cwd, "opencode.json")
    console.log(`[better-opencode] installing to project ${cwd}`)
  }

  const copied = syncCommands(targetCommandsDir)
  console.log(`[better-opencode] synced ${copied} command(s) -> ${targetCommandsDir}`)

  const added = ensurePluginInConfig(configPath)
  if (added) console.log(`[better-opencode] added 'better-opencode' to ${configPath}`)
  else console.log(`[better-opencode] plugin already present in ${configPath} (or --no-config)`)

  const globalCmd = join(homedir(), ".config", "opencode", "commands")
  if (!isGlobal && existsSync(globalCmd)) {
    console.log(`[better-opencode] note: global commands also exist at ${globalCmd}`)
  }
  if (isGlobal) {
    console.log(`[better-opencode] also supports per-project: npx better-opencode (without --global)`)
  } else {
    console.log(`[better-opencode] for global install: npx better-opencode --global`)
  }

  console.log("[better-opencode] done. Restart opencode to load plugin and commands.")
}

main()
