export type LogLevel = "debug" | "info" | "warn" | "error"

export class Logger {
  constructor(
    private readonly debugEnabled: boolean = false,
    private readonly prefix = "[better-opencode]",
  ) {}

  debug(message: string, meta?: unknown): void {
    if (!this.debugEnabled) return
    console.log(`${this.prefix} DEBUG ${message}`, meta ?? "")
  }

  info(message: string, meta?: unknown): void {
    console.log(`${this.prefix} INFO ${message}`, meta ?? "")
  }

  warn(message: string, meta?: unknown): void {
    console.warn(`${this.prefix} WARN ${message}`, meta ?? "")
  }

  error(message: string, meta?: unknown): void {
    console.error(`${this.prefix} ERROR ${message}`, meta ?? "")
  }

  child(suffix: string): Logger {
    return new Logger(this.debugEnabled, `${this.prefix}:${suffix}`)
  }
}

export const noopLogger = new Logger(false)
