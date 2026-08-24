import { describe, it, expect } from "vitest"
import { ComputeRouter } from "./router.js"

describe("compute router", () => {
  it("selectCompute auto prefers local when no api key", () => {
    delete process.env.VOYAGE_API_KEY
    delete process.env.OPENAI_API_KEY
    const r = new ComputeRouter({ adaptive: "auto" })
    expect(r.selectCompute()).toBe("local")
  })
  it("router records failure and backoff", () => {
    process.env.VOYAGE_API_KEY = "test"
    const r = new ComputeRouter({ adaptive: "api" })
    expect(r.selectCompute()).toBe("api")
    r.recordApiFailure()
    r.recordApiFailure()
    r.recordApiFailure()
    expect(r.selectCompute()).toBe("local")
    delete process.env.VOYAGE_API_KEY
  })
})
