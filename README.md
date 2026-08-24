# better-opencode

Self-improving opencode plugin that learns from your sessions. It watches tool use, keeps bounded instincts, and promotes the ones that actually help into real skills.

## What this does

- Records tool calls and error to fix pairs while you work.
- Keeps T1 instincts in `~/.cache/better-opencode/instincts.json` with 7 to 30 day TTL, scored decay, and FTS5 search capped to 2200 chars in system context.
- Promotes good instincts to T2 skills in `.agents/skills` and `.claude/skills` only when `auto-generated: true`, confidence reaches 3, hits reach 3, and `maxSkillsPerSession` guard allows it (max 5 per session). `src/curator/promotionService.ts` gates on threshold 3 and 3 hits, `src/curator/guardrails.ts` enforces the per session cap, and every write versions history for rollback.
- Archives older material to T3 `~/.config/opencode/skills-library` and versions every skill write so you can roll back.
- Retrieves context with hybrid search over vector cosine, BM25, and AST symbol match merged by RRF k 60, then boosts definition and file coherence and does an optional cross encoder rerank. Injection stays under 4000 tokens in a `<retrieved>` block.
- Caches chunk and embedding work by `sha256(text + chunkerVersion + embedderModel)` so reindexing is cheap unless files change.
- Picks compute locally by default. The router stays local when free memory drops below 500 MB and falls back to the API only when keys are present and local calls fail three times.

## Install

Use npm or connect as an opencode plugin. The plugin entry is `src/index.ts`.

```jsonc
// opencode.json
{
  "plugins": {
    "selfImproving": {
      "enabled": true,
      "systemBudget": 2200,
      "ragTokenBudget": 4000,
      "maxSkillsPerSession": 5,
      "confidenceThreshold": 3,
      "vectorStore": "memory",
      "compute": "auto"
    }
  }
}
```

Example defaults live in `opencode.json.example`. Copy it and adjust thresholds if you want more frequent promotion.

Build and typecheck from a clean checkout:

```bash
npm ci
npm run typecheck
npm run build
npm test
```

## Commands

- `teach` tool: store an explicit instinct. I use this when you type `/teach` or call `teach`. It writes with `explicitWeight 3` and TTL 30 days so explicit guidance outranks synthesized instincts.

```json
teach: { text: "always validate input before processing" }
```

- `self-improve` tool: inspect and control what the system learned.

```json
self-improve: { action: "status" }                // budgets, counts, guardrail remaining
self-improve: { action: "history", slug: "my-skill" } // version list for a skill
self-improve: { action: "rollback", slug: "my-skill", version: 2 }
self-improve: { action: "tune" }                 // rescan repo, rerun 5 to 7 question interview when drift shows
self-improve: { action: "health" }               // counts, cache size, drift state, guardrail
```

The CLI paths in `AGENTS.md` are `/self-improve status`, `/self-improve history`, `/self-improve rollback`, `/teach`. They call the same handlers above.

## Where things live

- T1 instincts: `~/.cache/better-opencode/instincts.json` (also per-repo `.better-opencode/instincts.json` when you pass a store path). Max 200, FTS5 searchable, GC evicts expired decayed entries below 0.5 score.
- T1 cache: `~/.cache/better-opencode/cache.json` and `~/.cache/better-opencode/cache.sqlite` when sqlite is available. Key is the content hash. L1 holds 1000 entries in memory, L2 persists.
- T2 skills: `projectRoot/.agents/skills/<slug>/SKILL.md` and `projectRoot/.claude/skills/<slug>/SKILL.md` (mirrored). Version history sits next to the skill as `history.json`.
- T3 archive: `~/.config/opencode/skills-library` keeps the last promoted copy for global recall.
- Interviews: `~/.cache/better-opencode/interview-<safe>.json` where `safe` is the repo root sanitized to 40 chars stores the adaptive 5 to 7 question answers so setup only asks once unless drift resets it. See `src/quiz/interview.ts:112-115`.

## Rollback and runbook

This section is the rollback/runbook the production audit asked for.

**If a promoted skill is wrong:**

```json
self-improve: { action: "history", slug: "bad-skill" }
self-improve: { action: "rollback", slug: "bad-skill", version: 1 }
```

Or delete it directly and clear the cache entry:

```bash
rm -rf .agents/skills/bad-skill .claude/skills/bad-skill
rm ~/.config/opencode/skills-library/bad-skill.md
npm test
```

The plugin versions each write as `.bak.N` next to the skill. Rollback restores the exact file and updates `.agents/skills` and `.claude/skills` together. No migration step is needed for v0.1 stores.

**If instincts look stale or too noisy:**

- List them: `self-improve: { action: "status" }` shows count and top decayed scores.
- Clear them for the repo: `rm projectRoot/.better-opencode/instincts.json` or for global `rm ~/.cache/better-opencode/instincts.json`.
- Rerun tuning: `self-improve: { action: "tune" }` rescans languages and frameworks and writes a fresh interview when deps or file layout drift exceeds 30 percent or 20 percent respectively.

**Cache invalidation:**

```bash
rm -rf ~/.cache/better-opencode
```

The next session rebuilds the index from scratch. The indexer already skips unchanged files by `sha256(text + chunkerVersion + embedderModel)`, so you do not need a manual clear unless the chunker or embedder version changed in a way you want to force.

**Guardrail tripped:**

The log says `Guardrail: max 5/5 skills per session`. The session counter resets on the next session or after `session.compacted`. No data is lost. The candidate stays in T1 and promotion retries next idle.

**Lock contention:**

Instincts and cache writes use atomic write tmp plus fsync plus rename plus fsync directory with a 5 second `withFileLock` that uses `O_EXCL` and retries every 50 ms. If you see a stale lock file older than 10 seconds the next write overwrites it. No manual cleanup is needed.

## Architecture in one page

- `src/config.ts` merges defaults, global file, project file, and env in that order and validates with zod. Change defaults there.
- `src/stores/instinctsStore.ts` bounds snapshots to 2200 and 1375 chars, enforces cap, and applies `score * exp(-ageDays / ttlDays)` decay. Callers read `frozenSnapshot` at system transform and `workingContext` during the turn.
- `src/stores/skillStore.ts` writes atomically and mirrors to both `.agents/skills` and `.claude/skills`. Promotion writes T3 and history.
- `src/rag/chunker.ts` tries `web-tree-sitter` WASM at function and class boundaries and falls back to regex and then 400 token windows with 20 percent overlap. Version is tracked so the hash key changes when the chunker changes.
- `src/rag/embedder.ts` picks `LocalOnnx` for `potion-code-16M` when onnx is installed and free memory is above 500 MB, otherwise a hashed local embedder, and falls back to `Voyage` only with an API key. `compute/router.ts` owns that decision and backs off for 60 seconds after three failures.
- `src/rag/vectorStore.ts` uses sqlite-vec vec0 when `better-sqlite3` and `sqlite-vec` are present and falls back to an in-memory BM25 plus cosine store that the tests exercise.
- `src/rag/hybridSearch.ts` fuses dense, BM25, and symbol ids with RRF k 60, adds file coherence 0.2 and definition 0.3, then runs a gated cross encoder on the top 50 down to 10 when `ENABLE_CROSS_ENCODER` and `onnxruntime-node` are available.
- `src/rag/indexer.ts` globs `**/*.{ts,js,tsx,jsx,mjs,cjs,py,rs,go,java}` excluding `node_modules/.git/dist/.agents/.claude/coverage/.cache`, checks the content hash cache, batches embeddings 32 at a time, and upserts both dense and BM25.
- `src/hooks.ts` merges instincts and RAG into `output.system[0]` instead of pushing a second system message. That keeps single system message backends such as Qwen and vLLM working. The RAG injection also prepends to the first user message when `messages.transform` is the active hook per the superpowers v5.0.7 fix.
- `src/curator/evolver.ts` scores with `reuse*1 + successRate*1.5 + tokenNorm*0.8 + explicit*3 + toolCalls*0.5` and synthesizes error fix instincts when a tool error is followed by a fix in the session ledger.
- `src/curator/guardrails.ts` and `PromotionService` enforce `maxSkillsPerSession` and `auto-generated: true` and keep T3 history for rollback.

## Troubleshooting

**No RAG results:** Run `self-improve: { action: "status" }` and check `vectorStore.count`. If it is 0, the indexer skipped files under 10 bytes or over 500 k truncated. Ensure the project root used at init matches the one you query.

**Secrets scrubbed too eagerly:** The scanner anchors on `api[_-]?key`, `secret`, `password`, `Bearer`, `sk-`, `ghp_`, and `AKIA` with assignment or header context and replaces matches with `[REDACTED]`. Generic mentions of the word secret no longer trigger. See `src/rag/injectionScanner.ts:1-56`.

**Build still shows 2 warnings:** They are intentional non-strict files `better-sqlite3` and `sqlite-vec` dynamic imports. Lint tolerates them. Any other warning fails `npm run lint`.

## Version and license

Version is `0.1.0` in `package.json:1-47`. Types are strict TypeScript 5.6 with NodeNext. Tests use vitest 2.1 with v8 coverage thresholds of 80 percent lines and functions.
