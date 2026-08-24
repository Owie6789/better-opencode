import { freemem } from "node:os"
import { Logger } from "../utils/logger.js"

export type ComputeMode = "local" | "api"

export interface RouterOpts {
  adaptive: "auto" | "local" | "api"
}

export class ComputeRouter {
  private consecutiveApiFailures = 0
  private lastFallbackAt = 0

  constructor(
    private readonly opts: RouterOpts = { adaptive: "auto" },
    private readonly logger: Logger = new Logger(false),
  ) {}

  selectCompute(): ComputeMode {
    if (this.opts.adaptive === "local") return "local"
    if (this.opts.adaptive === "api") return this.tryApi() ? "api" : "local"

    const lowMem = freemem() < 500 * 1024 * 1024
    if (lowMem) {
      this.logger.info("low memory, forcing local compute")
      return "local"
    }

    const hasKeys = Boolean(process.env.VOYAGE_API_KEY ?? process.env.OPENAI_API_KEY)
    if (!hasKeys) return "local"

    if (this.consecutiveApiFailures >= 3) {
      const since = Date.now() - this.lastFallbackAt
      if (since < 60_000) return "local"
      this.consecutiveApiFailures = 0
    }

    return "api"
  }

  recordApiFailure(): void {
    this.consecutiveApiFailures++
    this.lastFallbackAt = Date.now()
    this.logger.warn(`API failure ${this.consecutiveApiFailures}, fallback to local`)
  }

  recordApiSuccess(): void {
    this.consecutiveApiFailures = 0
  }

  private tryApi(): boolean {
    const hasKeys = Boolean(process.env.VOYAGE_API_KEY ?? process.env.OPENAI_API_KEY)
    return hasKeys && this.consecutiveApiFailures < 3
  }
}
