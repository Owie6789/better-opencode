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

function errMessage(e) {
  return e instanceof Error ? e.message : String(e)
}

function stripJsonc(raw) {
  let out = ""
  let inStr = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    const next = raw[i + 1]
    if (inStr) {
      out += ch
      if (ch === "\\") {
        out += next ?? ""
        i++
      } else if (ch === '"') {
        inStr = false
      }
      continue
    }
    if (ch === '"') {
      inStr = true
      out += ch
      continue
    }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++
      continue
    }
    if (ch === "/" && next === "*") {
      i += 2
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++
      i++
      continue
    }
    out += ch
  }
  return out
}

function readConfigJson(configPath, isJsonc = false) {
  let raw
  try {
    raw = readFileSync(configPath, "utf8")
  } catch (e) {
    return { ok: false, error: `failed to read ${configPath}: ${errMessage(e)}` }
  }
  let parsed
  try {
    parsed = JSON.parse(isJsonc ? stripJsonc(raw) : raw)
  } catch (e) {
    return { ok: false, error: `invalid JSON in ${configPath}: ${errMessage(e)}` }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) { // NOSONAR S3403 null check required
    return { ok: false, error: `invalid config in ${configPath}: expected JSON object` }
  }
  return { ok: true, value: parsed }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) // NOSONAR S3403 null check required
}

function resolvePluginsEntry(json) {
  if (Array.isArray(json.plugin)) return { mode: "array", key: "plugin", value: json.plugin }
  if (Array.isArray(json.plugins)) return { mode: "array", key: "plugins", value: json.plugins }
  if (isPlainObject(json.plugins)) return { mode: "object", key: "plugins", value: json.plugins }
  if (json.plugin !== undefined || json.plugins !== undefined) return { mode: "invalid" }
  return { mode: "array", key: "plugin", value: [] }
}

function ensurePluginInConfig(configPath) {
  if (!shouldWriteConfig) return false
  const isJsonc = configPath.endsWith(".jsonc")
  let json = {}
  if (existsSync(configPath)) {
    const res = readConfigJson(configPath, isJsonc)
    if (!res.ok) {
      // A .jsonc file may contain comments; rewriting it with JSON.stringify would drop them.
      if (isJsonc) {
        console.warn(`[better-opencode] ${res.error}. Add "plugin": ["better-opencode"] manually.`)
        return false
      }
      console.error(`[better-opencode] ${res.error}`)
      process.exit(1)
    }
    json = res.value
  }
  const entry = resolvePluginsEntry(json)
  if (entry.mode === "invalid") {
    console.error('[better-opencode] invalid config: "plugin" must be an array or "plugins" an array/object')
    process.exit(1)
  }
  if (entry.mode === "object") {
    if (entry.value["better-opencode"] !== undefined) return false
    entry.value["better-opencode"] = true
  } else {
    if (entry.value.includes("better-opencode")) return false
    entry.value.push("better-opencode")
  }
  json[entry.key] = entry.value
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
    const globalDir = join(homedir(), ".config", "opencode")
    targetCommandsDir = join(globalDir, "commands")
    configPath = join(globalDir, existsSync(join(globalDir, "opencode.jsonc")) ? "opencode.jsonc" : "opencode.json")
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
