import { describe, it, expect } from "vitest"
import { Guardrails } from "./guardrails.js"

describe("Guardrails max5", () => {
  it("canPromote gates", () => {
    const g = new Guardrails(2)
    expect(g.canPromote()).toBe(true)
    g.recordPromotion()
    g.recordPromotion()
    expect(g.canPromote()).toBe(false)
    expect(g.getCount()).toBe(2)
  })
  it("reset", () => {
    const g = new Guardrails(1)
    g.recordPromotion()
    g.reset()
    expect(g.canPromote()).toBe(true)
  })
  it("validateSkill requires auto-generated true", () => {
    const g = new Guardrails(5)
    expect(g.validateSkill({ "auto-generated": false } as never).allowed).toBe(false)
    expect(g.validateSkill({ "auto-generated": true } as never).allowed).toBe(true)
  })
})
