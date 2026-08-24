import { describe, it, expect, beforeEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CacheStore } from "./cacheStore.js"

describe("CacheStore", () => {
  let dir: string
  let cache: CacheStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cache-"))
    cache = new CacheStore(join(dir, "cache.json"))
  })
  it("set get with sha256", () => {
    cache.set("file.ts:abcd", "hashedvalue")
    expect(cache.get("file.ts:abcd")).toBe("hashedvalue")
    rmSync(dir, { recursive: true, force: true })
  })
  it("miss returns undefined", () => {
    expect(cache.get("missing")).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
  it("persists to disk L2", () => {
    cache.set("k1", "v1")
    const c2 = new CacheStore(join(dir, "cache.json"))
    expect(c2.get("k1")).toBe("v1")
    rmSync(dir, { recursive: true, force: true })
  })
  it("LRU evicts when over 1000", () => {
    const small = new CacheStore(join(dir, "small.json"))
    for (let i = 0; i < 1005; i++) small.set(`k${i}`, `v${i}`)
    expect(small.get("k0")).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
  it("has and delete", () => {
    cache.set("k", "v")
    expect(cache.has("k")).toBe(true)
    cache.delete("k")
    expect(cache.has("k")).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})
