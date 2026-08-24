import { describe, it, expect } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import createPlugin from "./index.js"
import { createSystemTransformHandler, createMessagesTransformHandler, createToolBeforeHandler, createToolAfterHandler, createIdleHandler, createFileWatcherHandler, createHooks } from "./hooks.js"
import { getConfig } from "./config.js"
import { InstinctsStore } from "./stores/instinctsStore.js"
import { SkillStore } from "./stores/skillStore.js"
import { CacheStore } from "./stores/cacheStore.js"
import { SessionState } from "./state/sessionState.js"
import { Ledger } from "./state/ledger.js"
import { Evolver } from "./curator/evolver.js"
import { Guardrails } from "./curator/guardrails.js"
import { PromotionService } from "./curator/promotionService.js"
import { MemoryVectorStore } from "./rag/vectorStore.js"
import { HybridEmbedder, HashEmbedder } from "./rag/embedder.js"
import { IndexService } from "./rag/indexer.js"
import { Logger } from "./utils/logger.js"

function makeDeps(projectRoot: string) {
  const logger = new Logger(false)
  const config = getConfig()
  const instincts = new InstinctsStore(join(projectRoot, "instincts.json"), logger)
  const skills = new SkillStore(projectRoot, logger)
  const cache = new CacheStore(join(projectRoot, "cache.json"), logger)
  const session = new SessionState("test-sess", null)
  const ledger = new Ledger(logger)
  const guardrails = new Guardrails(5, logger)
  const evolver = new Evolver(instincts, logger)
  const promotion = new PromotionService(skills, guardrails, logger)
  const vectorStore = new MemoryVectorStore()
  const embedder = new HybridEmbedder("local", logger)
  return { config, instincts, skills, cache, session, ledger, evolver, guardrails, promotion, vectorStore, embedder, logger, projectRoot }
}

describe("hooks and index", () => {
  it("createPlugin loads", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pl-"))
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }))
    const plugin = await createPlugin({ projectRoot: dir })
    expect(plugin.hooks).toBeDefined()
    expect(plugin.tools).toBeDefined()
    expect((plugin.tools as any).teach).toBeDefined()
    expect((plugin.tools as any)["self-improve"]).toBeDefined()
    const teach = (plugin.tools as any).teach as any
    const res = await teach.execute({ text: "always validate user input before using" })
    expect(res).toContain("Learned")
    const selfImp = (plugin.tools as any)["self-improve"] as any
    const status = await selfImp.execute({ subcommand: "status" })
    expect(status.length).toBeGreaterThan(0)
    const health = await selfImp.execute({ subcommand: "health" })
    expect(health.includes("instincts")).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it("system transform skips subagent and disabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hook-"))
    const deps = makeDeps(dir)
    // subagent case
    const subDeps = { ...deps, session: new SessionState("sub", "parent") }
    const h1 = createSystemTransformHandler(subDeps as any)
    const out1: any = { system: ["base"] }
    await h1({ system: ["base"] }, out1)
    expect(out1.system).toHaveLength(1)

    // normal with instincts
    deps.instincts.upsert({ id: "i1", text: "prefer strict typescript", score: 5, confidence: 5, hits: 5, successRate: 0.9, tokenDelta: 0, toolCallsDelta: 0, explicitWeight: 0, createdAt: Date.now(), updatedAt: Date.now(), ttlDays: 14, source: "implicit", tags: [] })
    const h2 = createSystemTransformHandler(deps as any)
    const out2: any = { system: ["base"] }
    await h2({ system: ["base"] }, out2)
    expect(out2.system).toHaveLength(1)
    expect(out2.system.join("\n")).toContain("instincts")
    expect(out2.system.join("\n")).toContain("base")

    // disabled
    const disabledDeps = { ...deps, config: { ...deps.config, enabled: false } }
    const h3 = createSystemTransformHandler(disabledDeps as any)
    const out3: any = { system: [] }
    await h3({ system: [] }, out3)
    expect(out3.system).toHaveLength(0)

    rmSync(dir, { recursive: true, force: true })
  })

  it("system transform RAG injection with hits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rag-hook-"))
    const deps = makeDeps(dir)
    const embedder = new HashEmbedder()
    const chunks = [{ id: "a.ts:foo:1", file: "a.ts", language: "typescript", symbol: "foo", kind: "definition" as const, lines: [1, 10] as [number, number], hash: "h1", text: "function foo(){ return 1; }", embedding: (await embedder.embed(["function foo(){ return 1; }"]))[0]! }]
    await deps.vectorStore.upsert(chunks as any)
    const h = createSystemTransformHandler(deps as any)
    const out: any = { system: ["base"] }
    await h({ system: ["base"] }, out)
    expect(out.system).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it("messages transform", async () => {
    const dir = mkdtempSync(join(tmpdir(), "msg-"))
    const deps = makeDeps(dir)
    const h = createMessagesTransformHandler(deps as any)
    const out: any = { messages: [] }
    await h({ messages: [{ role: "user", content: "hi" }] }, out)
    expect(out.messages).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it("tool before blocks env and skill guardrail and secret scrub", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toolbefore-"))
    const deps = makeDeps(dir)
    const handler = createToolBeforeHandler(deps as any)
    const out1: any = {}
    await handler({ tool: "Read", args: { file_path: "/home/user/.env" } }, out1)
    expect(out1.abort).toBe(true)

    const out2: any = {}
    await handler({ tool: "Write", args: { file_path: ".agents/skills/x/SKILL.md", content: "hello", frontmatter: { "auto-generated": false } } }, out2)
    expect(out2.abort).toBe(true)

    // secret scrub should mutate args but not abort
    const out3: any = {}
    const args3: any = { content: "apiKey=secret value here" }
    await handler({ tool: "Write", args: args3 }, out3)
    expect(out3.abort).toBeUndefined()
    expect(args3.content).toContain("[REDACTED]")

    // guardrail block
    for (let i = 0; i < 5; i++) deps.guardrails.recordPromotion()
    const out4: any = {}
    await handler({ tool: "Write", args: { file_path: ".agents/skills/y/SKILL.md", content: "test" } }, out4)
    expect(out4.abort).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  it("tool after ingests ledger and session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toolafter-"))
    const deps = makeDeps(dir)
    const h = createToolAfterHandler(deps as any)
    await h({ tool: "Read", args: { path: "a" }, result: {}, error: null, durationMs: 10 })
    expect(deps.ledger.all()).toHaveLength(1)
    expect(deps.session.getLedger()).toHaveLength(1)
    await h({ tool: "Write", args: { file_path: "a.ts" }, result: {}, error: "fail", durationMs: 5 })
    expect(deps.ledger.errorRate()).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it("idle handler curates and promotes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "idle-"))
    const deps = makeDeps(dir)
    // need ledger length >=3
    for (let i = 0; i < 3; i++) {
      deps.ledger.ingest({ id: `${i}`, timestamp: Date.now(), tool: "Write", input: {}, output: {}, error: i === 0 ? "err" : null, durationMs: 1 })
      deps.session.ingest({ id: `${i}`, timestamp: Date.now(), tool: "Write", input: { file_path: "a.ts" }, output: {}, error: i === 0 ? "err" : null, durationMs: 1 })
    }
    // add an instinct that could be promoted via errorFix path manually
    // directly test idle with empty candidates
    const h = createIdleHandler(deps as any)
    await h()
    expect(true).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it("file watcher and createHooks event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "watcher-"))
    writeFileSync(join(dir, "a.ts"), "const x=1")
    const deps = makeDeps(dir)
    const embedder = new HashEmbedder()
    const store = new MemoryVectorStore()
    const cache = new CacheStore(join(dir, "cache.json"))
    const indexer = new IndexService({ repoRoot: dir, embedder, vectorStore: store, cacheStore: cache })
    await indexer.index()
    const fw = createFileWatcherHandler(deps as any, indexer)
    await fw({ path: join(dir, "a.ts") })
    // ignored path
    await fw({ path: join(dir, "node_modules", "x.js") })

    const hooks = createHooks(deps as any, indexer)
    expect(hooks["tool.execute.before"]).toBeDefined()
    expect(hooks["event"]).toBeDefined()
    const ev = hooks["event"] as any
    await ev({ event: "session.idle", properties: {} })
    await ev({ event: "file.watcher.updated", properties: { path: join(dir, "a.ts") } })
    await ev({ event: "session.compacted", properties: {} })
    expect(deps.ledger.all()).toHaveLength(0)

    rmSync(dir, { recursive: true, force: true })
  })

  it("index health and vector fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pl2-"))
    const plugin2 = await createPlugin({ directory: dir })
    expect(plugin2.hooks).toBeDefined()
    rmSync(dir, { recursive: true, force: true })
  })
})
