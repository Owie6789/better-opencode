import type { PluginConfig } from "./types.js"
import { InstinctsStore } from "./stores/instinctsStore.js"
import { SkillStore } from "./stores/skillStore.js"
import { CacheStore } from "./stores/cacheStore.js"
import { SessionState } from "./state/sessionState.js"
import { Ledger } from "./state/ledger.js"
import { Evolver } from "./curator/evolver.js"
import { Guardrails } from "./curator/guardrails.js"
import { PromotionService } from "./curator/promotionService.js"
import { MemoryVectorStore } from "./rag/vectorStore.js"
import { HybridEmbedder } from "./rag/embedder.js"
import { hybridSearch } from "./rag/hybridSearch.js"
import { selectForInjection } from "./rag/contextInjector.js"
import { IndexService } from "./rag/indexer.js"
import { scanSkillText, scrubSecrets } from "./rag/injectionScanner.js"
import { Logger } from "./utils/logger.js"

export interface HookDeps {
  config: PluginConfig
  instincts: InstinctsStore
  skills: SkillStore
  cache: CacheStore
  session: SessionState
  ledger: Ledger
  evolver: Evolver
  guardrails: Guardrails
  promotion: PromotionService
  vectorStore: MemoryVectorStore
  embedder: HybridEmbedder
  logger: Logger
  projectRoot: string
}

export function createSystemTransformHandler(deps: HookDeps) {
  return async (
    input: { system: string[] },
    output: { system: string[]; abort?: boolean },
  ): Promise<void> => {
    const { config, instincts, vectorStore, embedder, logger, session } = deps

    if (session.isSubAgent) {
      logger.debug("skip system transform for subagent")
      return
    }

    const beforeLen = output.system.join("\n").length

    if (!config.enabled) {
      logger.debug("plugin disabled")
      return
    }

    const snapshot = instincts.frozenSnapshot(config.systemBudget)
    if (snapshot.length > 0) {
      const text = `<instincts budget=\"${config.systemBudget}\">\n${snapshot}\n</instincts>`
      output.system.push(text)
      logger.debug(`injected instincts ${snapshot.length} chars`)
    }

    try {
      const lastUserMsg = ""
      if (lastUserMsg || vectorStore.count() > 0) {
        const query = lastUserMsg || "project context"
        const hits = await hybridSearch(query, vectorStore, embedder, { limit: 6, rrfK: 60 }, logger).catch(() => [])
        if (hits.length > 0) {
          const ragText = selectForInjection(hits, config.ragTokenBudget)
          if (ragText.length > 0) {
            const scrubbed = scrubSecrets(ragText)
            output.system.push(scrubbed)
            logger.debug(`injected RAG ${scrubbed.length} chars from ${hits.length} hits`)
          }
        }
      }
    } catch (err) {
      logger.warn("RAG injection failed", err)
    }

    const afterLen = output.system.join("\n").length
    logger.debug(`system transform before=${beforeLen} after=${afterLen} delta=${afterLen - beforeLen}`)
  }
}

export function createMessagesTransformHandler(deps: HookDeps) {
  return async (
    input: { messages: Array<{ role: string; content: unknown }> },
    output: { messages: Array<{ role: string; content: unknown }> },
  ): Promise<void> => {
    void deps
    void input
    output.messages = [...input.messages]
  }
}

export function createToolBeforeHandler(deps: HookDeps) {
  return async (input: { tool: string; args: Record<string, unknown> }, output: { abort?: boolean; reason?: string }): Promise<void> => {
    const { logger } = deps
    const tool = input.tool
    const args = input.args

    if (tool === "Read" || tool === "Write" || tool === "Edit") {
      const fp = (args.file_path ?? args.path ?? "") as string
      if (typeof fp === "string" && fp.includes(".env") && !fp.endsWith(".env.example")) {
        if (fp.includes("~/.env") || fp.endsWith(".env")) {
          logger.warn(`Blocked env file access: ${fp}`)
          output.abort = true
          output.reason = "Blocked .env file access by guardrail"
          return
        }
      }
    }

    if (tool === "Write" || tool === "Edit") {
      const content = (args.content ?? args.new_string ?? "") as string
      if (typeof content === "string" && content.length > 0) {
        const scan = scanSkillText(content)
        if (!scan.safe) {
          logger.warn(`Blocked tool ${tool} due to ${scan.reason}: ${scan.matched}`)
          if (scan.reason === "secret detected") {
            args.content = scrubSecrets(content) as unknown as typeof args.content
          }
        }
      }
    }

    if (tool === "SkillCreate" || tool === "Write") {
      const target = (args.file_path ?? args.path ?? "") as string
      if (typeof target === "string" && target.includes(".agents/skills")) {
        const slug = target.split("/").slice(-2, -1)[0] ?? "unknown"
        if (!deps.guardrails.canPromote()) {
          output.abort = true
          output.reason = `Guardrail: max ${deps.guardrails.getCount()}/5 skills per session`
          logger.warn(`Blocked skill write ${slug}: guardrail`)
          return
        }
        const fm = (args.frontmatter ?? {}) as Record<string, unknown>
        if (fm["auto-generated"] === false) {
          output.abort = true
          output.reason = "Blocked: only auto-generated skills allowed"
          return
        }
      }
    }
  }
}

export function createToolAfterHandler(deps: HookDeps) {
  return async (input: {
    tool: string
    args: Record<string, unknown>
    result: unknown
    error?: string | null
    durationMs?: number
    tokenUsage?: { input: number; output: number; total: number }
  }): Promise<void> => {
    const { session, ledger, logger } = deps
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      tool: input.tool,
      input: input.args,
      output: input.result,
      error: input.error ?? null,
      durationMs: input.durationMs ?? 0,
      tokenUsage: input.tokenUsage,
    }
    ledger.ingest(entry)
    session.ingest(entry)
    logger.debug(`tool after ${input.tool} error=${entry.error !== null}`)
  }
}

export function createIdleHandler(deps: HookDeps) {
  return async (): Promise<void> => {
    const { session, evolver, promotion, ledger, logger, config } = deps
    session.markIdle()
    if (ledger.all().length < 3) return

    const candidates = evolver.curate(session)
    if (candidates.length === 0) {
      logger.debug("idle: no promotable candidates")
      return
    }

    for (const inst of candidates) {
      if (!deps.guardrails.canPromote()) {
        logger.info(`idle: guardrail stops at ${deps.guardrails.getCount()}/${config.maxSkillsPerSession}`)
        break
      }
      const res = promotion.tryPromote(inst)
      if (res.promoted) {
        session.recordPromotion()
        logger.info(`idle promoted ${inst.id} → ${res.slug}`)
      } else {
        logger.debug(`idle not promoted ${inst.id}: ${res.reason}`)
      }
    }
  }
}

export function createFileWatcherHandler(deps: HookDeps, indexer: IndexService) {
  return async (input: { path: string }): Promise<void> => {
    const { logger, projectRoot } = deps
    const rel = input.path.startsWith(projectRoot) ? input.path.slice(projectRoot.length + 1) : input.path
    if (rel.includes("node_modules") || rel.includes(".git") || rel.includes("dist")) return
    try {
      await indexer.updateFile(projectRoot, rel)
      logger.debug(`incremental reindex ${rel}`)
    } catch (err) {
      logger.warn(`reindex failed ${rel}`, err)
    }
  }
}

export function createHooks(deps: HookDeps, indexer?: IndexService): Record<string, unknown> {
  const hooks: Record<string, unknown> = {
    "experimental.chat.system.transform": createSystemTransformHandler(deps),
    "experimental.chat.messages.transform": createMessagesTransformHandler(deps),
    "tool.execute.before": createToolBeforeHandler(deps),
    "tool.execute.after": createToolAfterHandler(deps),
    "event": async (input: { event: string; properties?: Record<string, unknown> }) => {
      if (input.event === "session.idle") await createIdleHandler(deps)()
      if (input.event === "file.watcher.updated" && indexer) {
        const path = (input.properties?.path ?? input.properties?.file) as string | undefined
        if (path) await createFileWatcherHandler(deps, indexer)({ path })
      }
      if (input.event === "session.compacted") {
        deps.ledger.clear()
        deps.logger.info("ledger cleared on compaction")
      }
    },
  }
  return hooks
}
