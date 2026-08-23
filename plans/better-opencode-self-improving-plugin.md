# Blueprint: better-opencode Self-Improving Agent Plugin
*Generated: 2026-08-23 | Mode: direct (no git) | Model tier: default (steps 1-8), strongest for step 1 interface design*

## Objective
Port Hermes self-improving agent (bounded memory, self-writing skills, sidecar curator, progressive L0/L1/L2, injection scanner) as an aggressive autonomous OpenCode TypeScript plugin with hybrid AST+RAG persistent local index (tree-sitter + chunked embeddings, vector+BM25+AST hybrid + cross-encoder rerank + token budgeting), three-tier propagated skill management (T1 instincts.json TTL/scored → T2 .agents/skills + .claude mirror → T3 global skills-library), full observability, hybrid adaptive compute (onnx default / API fallback) with SHA256 content-hash cache, guardrailed evolution (max 5/session, auto-generated:true, versioned rollback), rich opencode.json config + slash commands (/self-improve status/history/rollback, /teach), and hybrid continuous LLM quiz (repo scan + adaptive 5-7Q interview + drift detection) — all verified websearch-only (no vault sniff).

## Pre-flight Checks (Research Phase)
- `git status` → not a git repo (direct mode). No branch/PR workflow; edits in-place with file versioning.
- `gh auth status` → n/a direct mode.
- `opencode --version` → check at step 1 (if missing, scaffold still valid; hooks are type-checked only).
- Existing project: `C:/Users/owie/Documents/Projects/better-opencode` empty; scaffold greenfield.
- Read `deep-research` report: `plans/deep-research-hermes-opencode-ast-rag.md` (27 sources). DCP architecture cloned as canonical hook pattern.
- Coding standards: TypeScript strict, no `any`, async/await, read-before-edit, immutability via spread, typed errors, batch parallel reads, grep sibling paths for root cause.

## Architecture Overview
```
Plugin entry (src/index.ts) ──► hooks adapter (src/hooks.ts)
  ├─ experimental.chat.system.transform → createSystemTransformHandler (instincts + RAG injection, 2200/4000 char budgets)
  ├─ experimental.chat.messages.transform → createMessagesTransformHandler (tool graph sync, pruning)
  ├─ tool.execute.before → guard (max skills, injection scanner, secret scrub)
  ├─ tool.execute.after  → observer (ledger, error→fix, token delta, tool-calls delta)
  ├─ event (session.idle/created/compacted, file.watcher.updated) → curator trigger
  ├─ config → inject primary_tools + commands
  └─ tool definitions (self-improve, teach)
Config (src/config.ts) merges: defaults → global ~/.config/opencode/config.json → project opencode.json → env
State (src/state/): sessionState, fingerprint, ledger
Stores (src/stores/): instinctsStore (T1), skillStore (T2/T3), cacheStore (SHA256 L1/L2)
RAG (src/rag/): chunker (tree-sitter WASM), embedder (onnx/voyage), vectorStore (sqlite-vec FTS5 + vec0), hybridSearch (RRF k60 + boosts + rerank), cache
Curator (src/curator/): evolver (confidence-gated), gc, promotionService
Quiz (src/quiz/): repoScanner, interview, driftDetector
Commands (src/commands/): selfImprove (status/history/rollback/tune), teach
```

## Dependency Graph & Parallelism
- Step 1 (scaffold + config + stores) → foundation; strongest-model design; serial
- Steps 2,3,4 parallel after Step 1 (no shared file outputs beyond interfaces):
  - Step 2 RAG pipeline (rag/*, cache)
  - Step 3 Observability + curator + guardrails (state, curator)
  - Step 4 Three-tier propagation (stores/skill, migration)
- Step 5 Quiz + Commands depends on Step 1+3 (needs state + config) but can start after Step 1; parallel with 2/3/4 if interfaces frozen (serialize to reduce merge risk — run after 2-4)
- Step 6 Hooks wiring depends on 1-5; serial
- Step 7 Integration + verification (tests, typecheck, lint, manual smoke) depends on 1-6
- Step 8 Production audit + hardening depends on 7

```
Step1 ─┬─► Step2 ─┐
       ├─► Step3 ─┼─► Step5 ─► Step6 ─► Step7 ─► Step8
       └─► Step4 ─┘
```

## Rollback Strategy (Per Step)
- Each step versions previous files via `*.bak.<timestamp>` and writes atomic `src/history/` manifests. Rollback is `cp bak → src` + `npm run typecheck`.
- Global: delete generated `plans/`, `src/`, `.agents/skills/.bak`, `~/.cache/better-opencode/` to revert.
- No git: manual file restore; after git init, use `git checkout -- .`.

---

### Step 1: Scaffold + Config + Core Stores + Coding Standards Baseline
**Branch**: direct **Model tier**: strongest (interface design)
**Context brief**: Empty `better-opencode` needs TypeScript strict scaffold that enforces coding-standards from day one. Establish plugin entry types, config merging, T1 instincts store, content-hash cache store, and base types so downstream steps can build cold without type drift.
**Tasks**:
- [ ] `npm init -y` + deps: `typescript@5.6`, `@opencode-ai/plugin@1.2.20`, `better-sqlite3`, `sqlite-vec` (or fallback `lance`), `web-tree-sitter`/`tree-sitter` + `tree-sitter-typescript|python|rust|go|java`, `onnxruntime-node`, `zod`, `vitest`, `tsx`, `glob`, `gray-matter`
- [ ] `tsconfig.json` strict (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`), `eslint` + `prettier`
- [ ] `package.json` scripts: `build`, `typecheck`, `test`, `lint`, `dev`
- [ ] `src/types.ts` — branded types: `Instinct`, `Skill`, `Chunk`, `Fingerprint`, `LedgerEntry`, `Config` with zod schemas
- [ ] `src/config.ts` — `getConfig(ctx)` merging defaults→global→project→env; shape `{enabled, confidenceThreshold:3, maxSkillsPerSession:5, maxInstincts:200, ttlDays:14, vectorStore:'sqlite-vec'|'lancedb', embeddingModel:'potion-code-16M', ragTokenBudget:4000, systemBudget:2200, adaptiveCompute:'auto'|'local'|'api'}`
- [ ] `src/stores/instinctsStore.ts` — FTS5-backed bounded memory (2200 snapshot, 1375 working), `FTS5(frozen_snapshot TEXT)`, score decay `score*exp(-age/ttl)`, max 200, fcntl-style file lock via `proper-lockfile` or atomic sqlite WAL
- [ ] `src/stores/cacheStore.ts` — SHA256 `hash=fileContent+chunkerVer+model` key, L1 LRU Map(1000), L2 sqlite `cache(hash PRIMARY KEY, blob BLOB, createdAt INT)` 
- [ ] `src/utils/hash.ts`, `src/utils/lock.ts`, `src/utils/logger.ts` (debug gated)
- [ ] `opencode.json` example with `plugin` and `selfImproving` block
**Verification**: `npm run typecheck` passes, `npm test -- --run` empty suite passes, `npm run lint` clean, `node --loader tsx src/config.ts` merges correctly.
**Exit criteria**: Types compile strict, config merges, instincts store CRUD + FTS5 search works, cache hit/miss works.
**Rollback**: delete `src/types.ts`, `src/config.ts`, `src/stores/*`, `package.json`, `tsconfig.json`.

### Step 2: AST RAG Hybrid Pipeline (Chunker + Embedder + VectorStore + Hybrid Search + Cache)
**Branch**: direct **Model tier**: default **Depends**: Step 1
**Context brief**: Implement aggressive hybrid retrieval: tree-sitter function/class chunking with definition/file coherence boosts, hybrid vector+BM25+AST via RRF k=60, ONNX cross-encoder rerank, token-budgeted injection. Must be offline-first with sqlite-vec vec0 vs LanceDB opt-in and SHA256 cache integration.
**Tasks**:
- [ ] `src/rag/chunker.ts` — `chunkFile(path, content): Chunk[]` using `web-tree-sitter` query `(function_definition|class_definition|method_definition) @def`; fallback to 400-token 20% overlap for unsupported; emit `{file, language, symbol, kind:'definition'|'usage', lines, hash, text}`
- [ ] `src/rag/embedder.ts` — `Embedder` interface `embed(texts:string[]): number[][]`; `LocalOnnxEmbedder` loads `potion-code-16M` ONNX (quantized) via `onnxruntime-node`; `VoyageEmbedder` fallback on `VOYAGE_API_KEY` or `OPENAI_API_KEY`; `HybridEmbedder` routes by `adaptiveCompute` + freemem check
- [ ] `src/rag/vectorStore.ts` — `VectorStore` interface `upsert(chunks)`, `search(vector,k)`, `bm25(query,k)`; `SqliteVecStore` with `vec0(embedding float[384])` + `fts5(text)` co-located; `LanceDBStore` opt-in; factory `createVectorStore(config)`
- [ ] `src/rag/hybridSearch.ts` — `hybridSearch(query, opts)` merges dense(k20)+BM25(k20)+AST exact(k10) via RRF k=60, applies `+0.3 definition boost`, `+0.2 file coherence` (multiple hits same file), then `rerank()` top50→10 via `cross-encoder MiniLM-L6-v2 ONNX`
- [ ] `src/rag/indexer.ts` — `IndexService` globs repo (`**/*.{ts,js,py,rs,go,java}` ignore `node_modules/.git`), content-hash guards (`cacheStore.get(hash)` hit → skip), batch embed 32, upsert, persist to `~/.cache/better-opencode/<repoHash>/index.sqlite`
- [ ] `src/rag/contextInjector.ts` — `selectForInjection(reranked, tokenBudget=4000)` token-count via `tiktoken` lite, priority by score, returns `string` with `<retrieved>` tags
**Verification**: `vitest src/rag/*.test.ts` chunker snapshot tests (TS/Python fixtures), embedder returns 384-dim, hybridSearch RRF deterministic, indexer cache hit reduces time, indexer on sample repo <2000 files completes <30s.
**Exit criteria**: `indexer.index(repoPath)` produces sqlite file, `hybridSearch("auth handler")` returns ranked `Chunk[]` with definition boost observable, token budgeting caps output.
**Rollback**: delete `src/rag/*`.

### Step 3: Observability + Confidence-Gated Evolution + Guardrails
**Branch**: direct **Model tier**: default **Depends**: Step 1
**Context brief**: Core aggressive evolution loop: capture full observability (tool graphs, error→fix, edits, token cost, tool-call delta), compute confidence score with weighted explicit signals (/teach/thumbs), curate new instincts, enforce guardrails (max 5/session, auto-generated:true, versioned history+rollback).
**Tasks**:
- [ ] `src/state/sessionState.ts` — `SessionState {id, ledger: LedgerEntry[], toolCallCount, tokenUsage, fileEdits:Set<string>, errors:Map<tool, {error, fixedAt}>}`
- [ ] `src/state/ledger.ts` — `Ledger.ingest(event: tool.execute.after)` populates tool graph edges `prevTool→nextTool`, captures `error→fix` pairs (edit after error), computes `toolCallsDelta` and `tokenDelta` per turn via `usage` field
- [ ] `src/curator/evolver.ts` — `Evolver.curate(sessionState)` computes `score = 1.0*reuse + 1.5*successRate + 0.8*tokenDeltaNormalized + 3.0*explicitWeight` (threshold `config.confidenceThreshold=3`); generates candidate instinct `text` via template + optional LLM synthesis (gated by adaptive compute); only persists if `score>=threshold && hits>=3 && successRate>0.6`
- [ ] `src/curator/gc.ts` — evict when `maxInstincts=200` or `age>ttlDays` or `score<0.5` with decay `score*exp(-age/ttl)`; archive evicted to T3 cold file
- [ ] `src/curator/guardrails.ts` — enforce `maxSkillsPerSession=5` counter per session, reject if `frontmatter.auto-generated!=true`, create `history/<ts>.md` before write, implement `rollback(slug, version)`
- [ ] `src/observability/metrics.ts` — expose `metrics.getToolGraph()`, `getErrorFixPairs()`, `getTokenTimeline()` for `/self-improve status`
**Verification**: `vitest` evolver scores deterministic, guardrail blocks 6th skill, GC caps at 200, error→fix correctly pairs a `read error` followed by `edit fix` in ledger.
**Exit criteria**: `tool.execute.after` event stream produces scored instincts, aggressive threshold promotes frequently in test harness, rollback restores previous `SKILL.md`.
**Rollback**: delete `src/state/*`, `src/curator/*`, `src/observability/*`.

### Step 4: Three-Tier Skill Propagation (T1→T2→T3)
**Branch**: direct **Model tier**: default **Depends**: Step 1
**Context brief**: Bounded T1 instincts.json → promoted T2 `.agents/skills/<slug>/SKILL.md` + `.claude/skills/<slug>/SKILL.md` mirror → cold T3 `~/.config/opencode/skills-library/<slug>/SKILL.md`. PromotionService watches evolver output and handles propagation, injection scanning, and GC archival.
**Tasks**:
- [ ] `src/stores/skillStore.ts` — `SkillStore` with `promote(instinct)→Skill` (slugify, frontmatter `{name, description, auto-generated:true, version:1, confidence, promotedAt, sourceInstinctId}`), `writeT2(skill)` atomic (`tmp→rename`) + mirror to `.claude`, `archiveT3(skill)` move low-score T2→T3, `listT2()`, `listT3()`, `rollback(slug, version)`
- [ ] `src/curator/promotionService.ts` — `if (instinct.score>=threshold && hits>=3)` call `skillStore.promote`, version bump `version=prev+1`, write history entry, enforce `maxSkillsPerSession` via `guardrails`; on weekly cron `archiveT3` where `score<0.5 && age>30d`
- [ ] `src/stores/fingerprint.ts` — `repoFingerprint = sha256(sorted dependency file contents + glob file list hash)` stored at `~/.cache/better-opencode/fp.json` for drift detection
- [ ] Injection scanner: `src/rag/injectionScanner.ts` — scrub skill text `/(api_key|secret|password|sk-)/i` before promotion; reject if hit
- [ ] Tests for promotion versioning, mirror consistency, archival.
**Verification**: Promotion creates both `.agents` and `.claude` files with correct frontmatter, history holds prior version, archival moves to T3, injection scanner rejects secret.
**Exit criteria**: `promotionService.promote(testInstinct)` creates T2+mirror with history, `skillStore.rollback(slug,1)` restores.
**Rollback**: delete `src/stores/skillStore.ts`, `src/curator/promotionService.ts`.

### Step 5: Quiz/Interview System + Commands + Adaptive Compute Wiring
**Branch**: direct **Model tier**: default **Depends**: Steps 1,3
**Context brief**: Hybrid continuous LLM quiz (repo scan → adaptive 5-7Q interview at setup + /self-improve tune + drift detection) plus slash commands (`/self-improve status|history|rollback|tune`, `/teach <text>`) and adaptive compute router (onnx default, API fallback if keys, freemem gate).
**Tasks**:
- [ ] `src/quiz/repoScanner.ts` — glob `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `.opencode/**`, detect frameworks (next, vite, django, fastapi, etc), emit `RepoProfile {languages, frameworks, packageManager, fileCount, deps}`
- [ ] `src/quiz/interview.ts` — `Interview.generate(profile)` → 5-7 adaptive questions (use `web-tree-sitter` language distribution + framework → template bank + LLM synthesize if `adaptiveCompute=api`); persists answers to `~/.config/opencode/self-improving-interview.json`
- [ ] `src/quiz/driftDetector.ts` — compare `fingerprint.current` vs stored weekly; if Jaccard `depsDiff>0.3` or `fileCount delta>20%`, set `needsReinterview=true` and surface in `status`
- [ ] `src/compute/router.ts` — `selectCompute()` returns `'local'|'api'` based on `config.adaptiveCompute`, env keys presence, `freemem()<500MB → local`, `api 429 → fallback local` with exponential backoff
- [ ] `src/commands/teach.ts` — `teach(text)` creates explicit weighted instinct (`explicitWeight=3`) bypassing threshold, immediate T1 insert
- [ ] `src/commands/selfImprove.ts` — `status` (ledger + tool graph + promotion queue), `history(slug)` (list versions), `rollback(slug, ver)`, `tune` (re-run interview)
- [ ] Wire commands via `tool` definitions or `command.execute.before` interceptor returning `output.abort` for help.
**Verification**: `repoScanner` on sample repo detects TS+vitest; `interview.generate` returns 5-7Q; `driftDetector` flags dep change; `teach` inserts high-weight instinct; `--help` for commands.
**Exit criteria**: Fresh install triggers scan+interview; `/teach` weight reflected in evolver score (3x); `/self-improve tune` re-interviews; drift surfaces.
**Rollback**: delete `src/quiz/*`, `src/commands/*`, `src/compute/*`.

### Step 6: Hooks Wiring (System/Messages Transform, Tool Guards, Event Subscriptions, Config Merging)
**Branch**: direct **Model tier**: default **Depends**: Steps 1-5
**Context brief**: Glue all subsystems into opencode plugin entry. This is the only step that imports every prior module and registers hooks per DCP pattern. Must respect mutation-side-effect contract (`output.system.push`, `output.messages=`) and log `before/after length` to catch discard confusion.
**Tasks**:
- [ ] `src/index.ts` — `export default async (ctx): Promise<Plugin>` loads `getConfig`, creates `logger`, `sessionState`, `instinctsStore`, `cacheStore`, `vectorStore`, `promotionService`, `evolver`, `ledger`, returns hook map
- [ ] `src/hooks.ts` — `createSystemTransformHandler(state, stores, rag, logger, config)` → inject bounded 2200-char instincts snapshot + 4000-token RAG context via `output.system.push({text})`; skip if `session.parentID` (subagent) or `agent==='compaction'`; log lengths
- [ ] `createMessagesTransformHandler` → sync ledger, run strategies (deduplicate similar tool calls, supersede writes if enabled), noop initially but preserve hook point for future pruning
- [ ] `tool.execute.before` → injection scanner + secret scrub + `guardrails.check()`
- [ ] `tool.execute.after` → `ledger.ingest`, `evolver.curate` trigger on `session.idle`
- [ ] `event` subscriptions: `session.idle`→curate, `session.created`→load state, `session.compacted`→clear ledger cache, `file.watcher.updated`→incremental reindex via `indexer.update(path)`
- [ ] `config` hook → inject `experimental.primary_tools: ['self-improve','teach']` and `/self-improve`, `/teach` commands
- [ ] `tool` definitions expose `self-improve` and `teach` as callable tools
**Verification**: `npm run build` emits `dist/index.js`; `vitest` hooks handler unit tests assert injection appears in `output.system`; manual smoke `npx opencode run --help` loads plugin without error (if opencode installed).
**Exit criteria**: Plugin loads, system transform injects frozen snapshot + RAG snippet, tool hooks observe ledger, subagent skips, lengths logged.
**Rollback**: revert `src/index.ts`, `src/hooks.ts`.

### Step 7: Integration + Verification Loop (Types, Tests, Lint, Smoke)
**Branch**: direct **Model tier**: default **Depends**: Steps 1-6
**Context brief**: Full verification per coding-standards + tdd-workflow. Every module already has unit tests; this step adds integration tests and runs full suite. Evidence-first: no claim of 'done' without tool output.
**Tasks**:
- [ ] `tests/integration/hybrid.test.ts` — end-to-end: `index DCP-like repo → query → hybridSearch returns definition-boosted chunks → injection budget respected`
- [ ] `tests/integration/evolution.test.ts` — simulate 10 tool calls with 3 error→fix pairs → evolver promotes 1 skill respecting `max5/session` + versioned history
- [ ] `tests/integration/quiz.test.ts` — repoScan → interview → teach → drift flag
- [ ] Coverage: `vitest --coverage` gate 80% for `src/stores`, `src/rag`, `src/curator` (branch coverage via `c8`)
- [ ] `npm run typecheck` strict clean, `npm run lint` clean, `npm run build` clean
- [ ] Add `tests/perf/rag.bench.ts` token injection latency <50ms p95 for cached hit
**Verification**: `npm run typecheck && npm run lint && npm test -- --run --coverage` all green; integration snapshots stable.
**Exit criteria**: All verification commands pass, coverage ≥80%, integration tests prove aggressive promotion and RAG contract.
**Rollback**: delete `tests/integration/*`.

### Step 8: Production Audit & Hardening (Security, Ops, Data Integrity, UX)
**Branch**: direct **Model tier**: default **Depends**: Step 7
**Context brief**: Apply production-audit lenses: security/auth (secret scrub, `.env` guard), data integrity (atomic writes, WAL, rollback), ops (fail-fast env validation, health check, rollback docs), UX (slash command help, status output). Score 0-100 with blockers/high-value fixes.
**Tasks**:
- [ ] Audit `tool.execute.before` for path traversal (no `~/.env` read via plugin), add `output.abort` if `file_path.includes('.env') && !allow`
- [ ] Audit `skillStore.writeT2` atomicity (tmp file + fsync + rename), WAL enabled for sqlite, `fingerprint` cache invalidation safe
- [ ] Audit secrets: grep for `api_key|sk-` in `instinctsStore` and `skillStore` before write; fail-fast if `config` missing required env with `logger.error` and `process.exitCode=1` gated
- [ ] Add health check tool `self-improve.health` returns `{instincts, skills, indexSize, cacheHitRate, lastCurate}`
- [ ] Document `ROLLBACK.md` (version restore steps) and `ENV.md` (required env vars)
- [ ] Run production-audit scoring; cap at 69 if secret leak or missing rollback, cap at 84 if CI not green
- [ ] Fix all `Blockers`; list `High-value fixes` with priority.
**Verification**: `grep -R 'sk-' src/` no leak, `fs` atomic write test (kill -9 mid-write retains prior), health tool returns valid shape, audit score ≥85.
**Exit criteria**: Audit score ≥85 (Strong) with evidence checklist: files inspected, commands run, rollback docs present, health check reachable.
**Rollback**: delete `ROLLBACK.md`, `ENV.md`, hardening patches.

## Invariants (Verified After Every Step)
- `npm run typecheck` strict clean.
- No `any`, no direct mutation without spread, no sync `fs` blocking event loop except atomic rename path.
- Every `src/*.ts` has sibling `*.test.ts` or integration coverage.
- Plugin hook mutations use `output.system.push` / `output.messages=` only.
- Token budgets enforced (2200 instincts, 4000 RAG) — assert in system handler tests.
- `maxSkillsPerSession=5` and `auto-generated:true` guard never bypassed.

## Anti-Patterns to Avoid (Checklist)
- [ ] No speculative generality (YAGNI) — only implement Q1-Q8 agreed features.
- [ ] No god-file `src/index.ts` >150 lines — delegate to `hooks.ts`/`stores/*`.
- [ ] No `npx <pkg>@latest` in audit — local evidence only.
- [ ] No uploading repo to external scanner without approval.
- [ ] No silent hook discard — log before/after lengths and test capture.
- [ ] No unbounded `instincts.json` — enforce 200 cap + TTL.

## Done Definition
- Plugin installs via `file:./` in `opencode.json` `plugin[]`, loads without error, injects skills + RAG.
- `npm test -- --coverage` ≥80%, `npm run typecheck` clean, `npm run lint` clean.
- Production audit score Strong (85-100) with evidence.
- `plans/better-opencode-self-improving-plugin.md` and `plans/deep-research-hermes-opencode-ast-rag.md` present.

