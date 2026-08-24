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

function extractLastUserText(messages: Array<{ role: string; content: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== "user") continue
    const c = m.content
    if (typeof c === "string" && c.trim().length > 0) return c.trim().slice(0, 4000)
    if (Array.isArray(c)) {
      const parts: string[] = []
      for (const p of c) {
        if (typeof p === "string") parts.push(p)
        else if (p && typeof p === "object" && "text" in p && typeof (p as { text: unknown }).text === "string") parts.push((p as { text: string }).text)
        else if (p && typeof p === "object" && "content" in p && typeof (p as { content: unknown }).content === "string") parts.push((p as { content: string }).content)
      }
      const joined = parts.join("\n").trim()
      if (joined.length > 0) return joined.slice(0, 4000)
    } else if (c && typeof c === "object" && "text" in c && typeof (c as { text: unknown }).text === "string") {
      return (c as { text: string }).text.trim().slice(0, 4000)
    }
  }
  return ""
}

function scoreSkillForQuery(skill: { slug: string; frontmatter: { description: string; tags: string[] }; body: string }, query: string): number {
  const q = query.toLowerCase()
  const qTerms = q.split(/\s+/).filter(Boolean)
  const hay = `${skill.slug} ${skill.frontmatter.description} ${skill.frontmatter.tags.join(" ")} ${skill.body.slice(0, 500)}`.toLowerCase()
  let score = 0
  for (const t of qTerms) if (hay.includes(t)) score += 1
  if (skill.frontmatter.description.toLowerCase().includes(q.slice(0, 40))) score += 2
  return score
}

function buildSkillCatalogBlock(skills: ReturnType<SkillStore["listT2"]>, query: string, limit = 3): string {
  if (skills.length === 0) return ""
  const scored = skills
    .map((s) => ({ s, score: query ? scoreSkillForQuery(s as never, query) : 0 }))
    .sort((a, b) => b.score - a.score)
  const top = query ? scored.filter((x) => x.score > 0).slice(0, limit) : scored.slice(0, limit)
  if (top.length === 0) return ""
  const lines = top.map(({ s }) => `- ${s.slug}: ${s.frontmatter.description.slice(0, 120)}${s.frontmatter.tags.length ? ` [${s.frontmatter.tags.join(",")}]` : ""}`)
  return `<available-skills topK=\"${limit}\">\nActive project skills matching your prompt (T2 ${skills.length} total, T3 archived). Prefer these when relevant:\n${lines.join("\n")}\n</available-skills>`
}

export function createSystemTransformHandler(deps: HookDeps) {
  return async (
    input: { system: string[] },
    output: { system: string[]; abort?: boolean },
  ): Promise<void> => {
    const { config, instincts, skills, logger, session } = deps

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
    const pendingSystemInserts: string[] = []
    if (snapshot.length > 0) {
      pendingSystemInserts.push(`<instincts budget=\"${config.systemBudget}\">\n${snapshot}\n</instincts>`)
      logger.debug(`prepared instincts ${snapshot.length} chars`)
    }

    try {
      const allSkills = skills.listT2()
      if (allSkills.length > 0) {
        const catalog = buildSkillCatalogBlock(allSkills, "", 5)
        if (catalog.length > 0) {
          pendingSystemInserts.push(catalog)
          logger.debug(`prepared catalog ${allSkills.length} skills`)
        }
      }
    } catch (err) {
      logger.warn("catalog injection failed", err)
    }

    if (pendingSystemInserts.length > 0) {
      const merged = pendingSystemInserts.join("\n\n")
      if (output.system.length === 0) output.system.push(merged)
      else output.system[0] = `${output.system[0]}\n\n${merged}`
      logger.debug(`injected system merge ${merged.length} chars into primary block (Qwen compat, was ${pendingSystemInserts.length} inserts)`)
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
    const { config, vectorStore, embedder, skills, logger, session } = deps
    output.messages.splice(0, output.messages.length, ...input.messages)

    if (session.isSubAgent || !config.enabled) return

    const query = extractLastUserText(input.messages)
    if (!query) {
      logger.debug("messages transform: no user query")
      return
    }

    const pending: string[] = []

    try {
      if (vectorStore.count() > 0) {
        const hits = await hybridSearch(query, vectorStore, embedder, { limit: 3, rrfK: 60 }, logger).catch(() => [])
        if (hits.length > 0) {
          const ragText = selectForInjection(hits, config.ragTokenBudget)
          if (ragText.length > 0) pending.push(scrubSecrets(ragText))
        }
      }
    } catch (err) {
      logger.warn("messages RAG failed", err)
    }

    try {
      const allSkills = skills.listT2()
      const catalog = buildSkillCatalogBlock(allSkills, query, 3)
      if (catalog.length > 0) pending.push(catalog)
    } catch (err) {
      logger.warn("messages catalog failed", err)
    }

    if (pending.length > 0) {
      const merged = pending.join("\n\n")
      const injection = { role: "system" as const, content: merged } as unknown as { role: string; content: unknown }
      const insertAt = output.messages.length > 0 ? output.messages.length - 1 : 0
      output.messages.splice(insertAt, 0, injection)
      logger.debug(`messages transform injected ${merged.length} chars topK 3 at ${insertAt} query=\"${query.slice(0, 40)}\"`)
    }
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
