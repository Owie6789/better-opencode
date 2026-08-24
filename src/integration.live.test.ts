import { describe, it, expect } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import createPlugin from "./index.js"

function fixtureProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "live-e2e-"))
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", type: "module" }))
  writeFileSync(join(dir, "app.ts"), `export function add(a:number,b:number){ return a+b }\nexport const VERSION="1.0"`)
  mkdirSync(join(dir, "src"), { recursive: true })
  writeFileSync(join(dir, "src", "util.ts"), `export function greet(name:string){ return "hi "+name }`)
  return dir
}

describe("live opencode E2E via Plugin export", () => {
  it("exercises full plugin lifecycle as opencode would", async () => {
    const projectRoot = fixtureProject()
    try {
      const plugin = await createPlugin({ projectRoot, directory: projectRoot } as never)

    expect(plugin.hooks).toBeDefined()
    const hooks = plugin.hooks as Record<string, unknown>
    expect(hooks["experimental.chat.system.transform"]).toBeDefined()
    expect(hooks["experimental.chat.messages.transform"]).toBeDefined()
    expect(hooks["tool.execute.before"]).toBeDefined()
    expect(hooks["tool.execute.after"]).toBeDefined()
    expect(hooks["event"]).toBeDefined()

    const tools = plugin.tools as Record<string, { description: string; execute: (args: unknown) => Promise<unknown> }>
    expect(tools.teach).toBeDefined()
    expect(tools["self-improve"]).toBeDefined()

    const teach = tools.teach
    const taught = (await teach.execute({ text: "always prefer early returns over deep nesting" })) as string
    expect(taught).toContain("Learned")

    const sysHook = hooks["experimental.chat.system.transform"] as (input: unknown, output: unknown) => Promise<void>
    const sysOut: { system: string[] } = { system: ["You are helpful."] }
    await sysHook({ system: ["You are helpful."] }, sysOut)
    expect(sysOut.system).toHaveLength(1)
    expect(sysOut.system.join("\n")).toContain("You are helpful.")

    const beforeHook = hooks["tool.execute.before"] as (input: unknown, output: unknown) => Promise<void>
    const blockOut: Record<string, unknown> = {}
    await beforeHook({ tool: "Read", args: { file_path: ".env" } }, blockOut)
    expect(blockOut.abort).toBe(true)

    const afterHook = hooks["tool.execute.after"] as (input: unknown) => Promise<void>
    await afterHook({ tool: "Read", args: { file_path: "app.ts" }, result: { ok: true }, error: null, durationMs: 5 })
    await afterHook({ tool: "Write", args: { file_path: "app.ts" }, result: { ok: false }, error: "EACCES", durationMs: 5 })

    const eventHook = hooks["event"] as (input: { event: string; properties: unknown }) => Promise<void>
    await eventHook({ event: "file.watcher.updated", properties: { path: join(projectRoot, "app.ts"), kind: "change" } })
    await eventHook({ event: "session.idle", properties: {} })
    await eventHook({ event: "session.compacted", properties: {} })

    const selfImprove = tools["self-improve"]
    const status = (await selfImprove.execute({ subcommand: "status" })) as string
    expect(status.length).toBeGreaterThan(0)
    const health = (await selfImprove.execute({ subcommand: "health" })) as string
    expect(health.toLowerCase()).toContain("instincts")

    expect(existsSync(join(projectRoot, "app.ts"))).toBe(true)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  }, 30_000)
})
