import { copyFileSync, existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { getConfig, getCacheDir, getInstinctsPath } from "./config.js"
import { ensureDir } from "./utils/lock.js"
import { InstinctsStore } from "./stores/instinctsStore.js"
import { SkillStore } from "./stores/skillStore.js"
import { CacheStore } from "./stores/cacheStore.js"
import { SessionState } from "./state/sessionState.js"
import { Ledger } from "./state/ledger.js"
import { Evolver } from "./curator/evolver.js"
import { Guardrails } from "./curator/guardrails.js"
import { PromotionService } from "./curator/promotionService.js"
import { createVectorStore } from "./rag/vectorStore.js"
import { HybridEmbedder } from "./rag/embedder.js"
import { IndexService, cacheDirForRepo } from "./rag/indexer.js"
import { createHooks } from "./hooks.js"
import { TeachCommand } from "./commands/teach.js"
import { SelfImproveCommand } from "./commands/selfImprove.js"
import { Logger } from "./utils/logger.js"
import type { PluginConfig } from "./types.js"

export interface PluginContext {
  projectRoot?: string
  directory?: string
}

export interface Plugin {
  config?: unknown
  hooks?: Record<string, unknown>
  tools?: Record<string, unknown>
}

export default async function createPlugin(ctx?: PluginContext): Promise<Plugin> {
  const projectRoot = ctx?.projectRoot ?? ctx?.directory ?? process.cwd()
  const config: PluginConfig = getConfig(projectRoot)
  const debug = process.env.BETTER_OPENCODE_DEBUG === "true"
  const logger = new Logger(debug)

  const instinctsPath = getInstinctsPath(projectRoot)
  const legacyPath = join(getCacheDir(), "instincts.json")
  if (projectRoot && !existsSync(instinctsPath) && existsSync(legacyPath) && instinctsPath !== legacyPath) {
    try {
      ensureDir(dirname(instinctsPath))
      copyFileSync(legacyPath, instinctsPath)
      logger.info(`migrated legacy instincts to ${instinctsPath}`)
    } catch (err) {
      logger.warn("legacy instincts migration failed", err)
    }
  }

  const instincts = new InstinctsStore(instinctsPath, logger, config.maxInstincts)
  const skills = new SkillStore(projectRoot, logger)
  const cache = new CacheStore(undefined, logger)
  const session = new SessionState(`sess-${Date.now()}`, null)
  const ledger = new Ledger(logger)
  const guardrails = new Guardrails(config.maxSkillsPerSession, logger)
  const evolver = new Evolver(instincts, logger, {
    confidenceThreshold: config.confidenceThreshold,
    minHits: 3,
    minSuccessRate: 0.6,
  })
  const promotion = new PromotionService(skills, guardrails, logger)

  const embedder = new HybridEmbedder(config.adaptiveCompute, logger)
  const vectorStore = createVectorStore(config.vectorStore, logger)

  let indexer: IndexService | undefined
  try {
    indexer = new IndexService({ repoRoot: projectRoot, embedder, vectorStore, cacheStore: cache }, logger)
    const marker = join(cacheDirForRepo(projectRoot), ".indexed")
    let fresh = false
    if (existsSync(marker)) {
      try {
        const age = Date.now() - Date.parse(readFileSync(marker, "utf8").trim())
        fresh = Number.isFinite(age) && age < 7 * 24 * 60 * 60 * 1000
      } catch {
        fresh = false
      }
    }
    if (!fresh) {
      indexer.index().catch((err) => logger.warn("initial index failed", err))
    }
  } catch (err) {
    logger.warn("indexer init failed", err)
  }

  const teachCmd = new TeachCommand(instincts, logger)
  const selfImproveCmd = new SelfImproveCommand(instincts, skills, ledger, session, cache, logger, projectRoot, vectorStore)

  const deps = {
    config,
    instincts,
    skills,
    cache,
    session,
    ledger,
    evolver,
    guardrails,
    promotion,
    vectorStore,
    embedder,
    logger,
    projectRoot,
  }

  const hooks = createHooks(deps, indexer)

  const tools = {
    teach: {
      description: "Explicitly teach the agent a new instinct (weighted 3x). Usage: teach <text>",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "Instruction to remember" } },
        required: ["text"],
      },
      async execute(args: { text: string }): Promise<string> {
        const res = await teachCmd.execute(args.text, projectRoot)
        return res.message
      },
    },
    "self-improve": {
      description: "Self-improve commands: status | history <slug> | rollback <slug> [ts] | tune | health",
      parameters: {
        type: "object",
        properties: {
          subcommand: { type: "string", enum: ["status", "history", "rollback", "tune", "health"] },
          slug: { type: "string" },
          version: { type: "string" },
        },
        required: ["subcommand"],
      },
      async execute(args: { subcommand: string; slug?: string; version?: string }): Promise<string> {
        return selfImproveCmd.execute(args.subcommand as never, { slug: args.slug ?? "", version: args.version ?? "" })
      },
    },
  }

  logger.info(`better-opencode plugin loaded (threshold=${config.confidenceThreshold} maxSkills=${config.maxSkillsPerSession})`)

  return {
    config: {
      plugin: "better-opencode",
      selfImproving: config,
    },
    hooks,
    tools,
  }
}

export { getConfig } from "./config.js"
export { InstinctsStore } from "./stores/instinctsStore.js"
export { SkillStore } from "./stores/skillStore.js"
export { CacheStore } from "./stores/cacheStore.js"
