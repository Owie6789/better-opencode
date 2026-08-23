import { describe, it, expect, beforeEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { InstinctsStore } from "./instinctsStore.js"
import type { Instinct } from "../types.js"

function makeInst(id: string, text: string, score = 3, hits = 3): Instinct {
  return {
    id,
    text,
    score,
    confidence: 5,
    hits,
    successRate: 0.8,
    tokenDelta: 100,
    toolCallsDelta: 2,
    explicitWeight: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ttlDays: 14,
    source: "implicit",
    tags: [],
  }
}

describe("InstinctsStore", () => {
  let dir: string
  let store: InstinctsStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "inst-"))
    store = new InstinctsStore(join(dir, "instincts.json"))
  })
  it("add and persist", () => {
    store.add(makeInst("a", "hello world"))
    expect(store.findById("a")?.text).toBe("hello world")
    const store2 = new InstinctsStore(join(dir, "instincts.json"))
    expect(store2.findById("a")?.text).toBe("hello world")
    rmSync(dir, { recursive: true, force: true })
  })
  it("frozenSnapshot bounded", () => {
    for (let i = 0; i < 10; i++) store.add(makeInst(`id${i}`, `instinct number ${i} with some text`))
    const snap = store.frozenSnapshot(2200)
    expect(snap.length).toBeLessThanOrEqual(2200)
    const working = store.workingContext(1375)
    expect(working.length).toBeLessThanOrEqual(1375)
    rmSync(dir, { recursive: true, force: true })
  })
  it("search ranks by score", () => {
    store.add(makeInst("low", "foo bar", 1))
    store.add(makeInst("high", "foo bar baz", 9))
    const res = store.search("foo")
    expect(res[0]?.id).toBe("high")
    rmSync(dir, { recursive: true, force: true })
  })
  it("enforceCap keeps top scored", () => {
    const capStore = new InstinctsStore(join(dir, "capped.json"), undefined as never, 2)
    capStore.add(makeInst("a", "a", 1))
    capStore.add(makeInst("b", "b", 9))
    capStore.add(makeInst("c", "c", 5))
    expect(capStore.count()).toBe(2)
    expect(capStore.findById("a")).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
  it("decayedScore and gc", () => {
    const old = makeInst("old", "old text", 0.1, 1)
    old.updatedAt = Date.now() - 20 * 24 * 60 * 60 * 1000
    old.ttlDays = 14
    store.add(old)
    const evicted = store.gc(14)
    expect(evicted.some((i) => i.id === "old")).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
  it("remove and clear", () => {
    store.add(makeInst("x", "x"))
    expect(store.remove("x")).toBe(true)
    expect(store.findById("x")).toBeUndefined()
    store.add(makeInst("y", "y"))
    store.clear()
    expect(store.count()).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })
})
