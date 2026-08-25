import { describe, it, expect } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { getCacheDir, repoHashForRoot } from "./config.js"
import { createLockFile, withFileLock, withFileLockSync, resolveLockOptions } from "./utils/lock.js"
import { DriftDetector, depsDiff, computeDrift, needsReinterview } from "./quiz/driftDetector.js"
import { scanRepo } from "./quiz/repoScanner.js"
import { MemoryVectorStore, SqliteVecVectorStore, createVectorStore } from "./rag/vectorStore.js"
import { HashEmbedder } from "./rag/embedder.js"
import { Logger } from "./utils/logger.js"

function makeChunk(id: string, text: string, opts: Partial<{ file: string; kind: "definition" | "chunk"; embedding?: number[] }> = {}) {
  return {
    id,
    file: opts.file ?? `${id}.ts`,
    language: "typescript",
    symbol: null,
    kind: opts.kind ?? ("chunk" as const),
    lines: [1, 2] as [number, number],
    hash: `h-${id}`,
    text,
    embedding: opts.embedding,
  }
}

describe("lock options and contention", () => {
  it("resolveLockOptions merges defaults", () => {
    expect(resolveLockOptions()).toEqual({ timeoutMs: 5000, staleMs: 10000 })
    expect(resolveLockOptions({ timeoutMs: 10 }).staleMs).toBe(10000)
  })

  it("withFileLockSync throws on held lock after short timeout", () => {
    const dir = mkdtempSync(join(tmpdir(), "lk-cont-"))
    const p = join(dir, "held.lock")
    expect(createLockFile(p, "other-owner")).toBe(true)
    expect(() => withFileLockSync(p, () => 1, { timeoutMs: 120 })).toThrow(/Failed to acquire lock/)
    rmSync(dir, { recursive: true, force: true })
  })

  it("withFileLock throws on held lock after short timeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lk-cont-a-"))
    const p = join(dir, "held.lock")
    expect(createLockFile(p, "other-owner")).toBe(true)
    await expect(withFileLock(p, async () => 1, { timeoutMs: 150 })).rejects.toThrow(/Failed to acquire lock/)
    rmSync(dir, { recursive: true, force: true })
  })

  it("async reentrancy returns directly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lk-re-"))
    const p = join(dir, "re.lock")
    const res = await withFileLock(p, async () => withFileLock(p, async () => "inner", { timeoutMs: 50 }), { timeoutMs: 500 })
    expect(res).toBe("inner")
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("driftDetector paths", () => {
  function seedRepo(dir: string, deps: Record<string, string>): void {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: deps }))
    writeFileSync(join(dir, "a.ts"), "const a = 1")
  }

  it("first check saves fingerprint no drift", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dd-"))
    seedRepo(dir, { react: "18" })
    const dd = new DriftDetector(0.3, new Logger(false))
    const res = await dd.check(dir)
    expect(res.drifted).toBe(false)
    expect(res.currentHash).toBeDefined()
    rmSync(getCacheDir(repoHashForRoot(dir)), { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it("depsDiff union and identical cases", () => {
    expect(depsDiff({}, {})).toBe(0)
    expect(depsDiff({ a: "1" }, { a: "1" })).toBe(0)
    expect(depsDiff({ a: "1" }, { b: "1" })).toBe(1)
    expect(depsDiff({ a: "1", b: "2" }, { a: "1", c: "3" })).toBeCloseTo(2 / 3, 5)
  })

  it("computeDrift flags dep and file drift separately", () => {
    const base = { hash: "h1", fileCount: 10, depsHash: "d1" }
    const sameHash = computeDrift(base, base)
    expect(sameHash.drifted).toBe(false)
    expect(sameHash.hashChanged).toBe(false)
    const driftedDeps = computeDrift(
      { ...base, profile: { deps: { a: "1", b: "2", c: "3" } } },
      { ...base, hash: "h2", profile: { deps: { x: "9", y: "8", z: "7" } } },
    )
    expect(driftedDeps.drifted).toBe(true)
    expect(driftedDeps.depsDiff).toBe(1)
    const onlyFiles = computeDrift(
      { hash: "h1", fileCount: 10, depsHash: "d1", profile: { deps: {} } },
      { hash: "h2", fileCount: 20, depsHash: "d1", profile: { deps: {} } },
    )
    expect(onlyFiles.fileDelta).toBe(1)
    expect(onlyFiles.drifted).toBe(true)
    const zeroPrev = computeDrift({ ...base, fileCount: 0 }, { ...base, hash: "h2", fileCount: 5 })
    expect(zeroPrev.fileDelta).toBe(0)
    expect(zeroPrev.drifted).toBe(false)
  })

  it("needsReinterview respects drift and age", () => {
    expect(needsReinterview({ drifted: false }, 0)).toBe(false)
    expect(needsReinterview({ drifted: true }, Date.now() - 30 * 86400000)).toBe(true)
    expect(needsReinterview({ drifted: true }, Date.now())).toBe(false)
  })
})

describe("repoScanner package managers and languages", () => {
  it("detects python rust go and lockfiles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scan2-"))
    writeFileSync(join(dir, "main.py"), "print(1)")
    writeFileSync(join(dir, "requirements.txt"), "flask==2.0.1\nrequests>=2.0\n\n")
    writeFileSync(join(dir, "lib.rs"), "fn main(){}")
    writeFileSync(join(dir, "Cargo.toml"), "[package]\nname='x'")
    await scanRepo(dir)
    writeFileSync(join(dir, "go.mod"), "module x")
    writeFileSync(join(dir, "pnpm-lock.yaml"), "")
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { zod: "1", "@opencode-ai/plugin": "1" } }))
    const p2 = await scanRepo(dir)
    expect(p2.packageManager).toBe("pnpm")
    expect(p2.frameworks).toContain("python")
    expect(p2.frameworks).toContain("rust")
    expect(p2.frameworks).toContain("go")
    expect(p2.frameworks).toContain("opencode")
    expect(p2.frameworks).toContain("zod")
    expect(p2.deps["py:flask"]).toBe("flask==2.0.1")
    rmSync(dir, { recursive: true, force: true })
  })

  it("falls back to yarn then npm package manager", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scan3-"))
    writeFileSync(join(dir, "yarn.lock"), "")
    writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies: { vite: "1", express: "1", next: "1", vue: "1", react: "1", fastify: "1" } }))
    const p = await scanRepo(dir)
    expect(p.packageManager).toBe("yarn")
    for (const fw of ["vite", "express", "next", "vue", "react", "fastify"]) expect(p.frameworks).toContain(fw)
    rmSync(dir, { recursive: true, force: true })

    const dir2 = mkdtempSync(join(tmpdir(), "scan4-"))
    writeFileSync(join(dir2, "package-lock.json"), "{}")
    writeFileSync(join(dir2, "package.json"), "{}")
    writeFileSync(join(dir2, "unknown.xyz"), "data")
    const p2 = await scanRepo(dir2)
    expect(p2.packageManager).toBe("npm")
    expect(p2.languages.typescript).toBeUndefined()
    rmSync(dir2, { recursive: true, force: true })
  })

  it("handles empty dir and malformed package.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scan5-"))
    const p = await scanRepo(dir)
    expect(p.fileCount).toBe(0)
    expect(p.packageManager).toBeNull()
    writeFileSync(join(dir, "package.json"), "{broken json")
    const p2 = await scanRepo(dir)
    expect(p2.deps).toEqual({})
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("vectorStore branches", () => {
  it("search falls back to preview score when embeddings mismatch", async () => {
    const vs = new MemoryVectorStore(new Logger(false))
    await vs.upsert([makeChunk("c1", "some long text content here", {})])
    const hits = await vs.search([1, 2, 3], 5)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.chunk.id).toBe("c1")
    const empty = new MemoryVectorStore()
    await expect(empty.search([], 5)).resolves.toEqual([])
  })

  it("bm25 boosts definitions and file matches", async () => {
    const emb = new HashEmbedder()
    const vecs = await emb.embed(["calculate sum function body", "unrelated words entirely"])
    const vs = new MemoryVectorStore()
    await vs.upsert([
      makeChunk("d1", "calculate sum function", { kind: "definition", file: "calculate.ts", embedding: vecs[0] }),
      makeChunk("p1", "unrelated words entirely", { embedding: vecs[1] }),
    ])
    const hits = await vs.bm25("calculate sum", 2)
    expect(hits[0]?.chunk.id).toBe("d1")
    await vs.clear()
    expect(vs.count()).toBe(0)
    await expect(vs.bm25("anything", 5)).resolves.toEqual([])
  })

  it("sqlite fallback delegates and factory handles lancedb", async () => {
    const log = new Logger(false)
    const sq = new SqliteVecVectorStore(":memory:", log)
    await sq.upsert([makeChunk("s1", "text")])
    expect(sq.count()).toBe(1)
    expect((await sq.search([], 1)).length).toBe(1)
    expect((await sq.bm25("text", 1)).length).toBe(1)
    expect(sq.all()).toHaveLength(1)
    await sq.clear()
    expect(sq.count()).toBe(0)
    expect(createVectorStore("sqlite-vec", log)).toBeInstanceOf(SqliteVecVectorStore)
    expect(createVectorStore("lancedb", log)).toBeInstanceOf(MemoryVectorStore)
    expect(createVectorStore("unknown-kind", log)).toBeInstanceOf(MemoryVectorStore)
  })
})
