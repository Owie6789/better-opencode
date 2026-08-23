# Production Audit — better-opencode self-improving plugin

**Audit Date:** 2026-05-11 | **Scope:** current checkout + build + tests | **Coverage:** 86.51% lines

## Production audit: 82/100, launchable with caveats, CI workflow present but no run yet and no live E2E against real opencode runtime as the two caveats.

## Blockers
- [x] None critical — no secrets in client bundle, no payment webhooks, no auth bypass. Previous blockers (chunker arg-swap, injection scrub, cache LRU, ledger/session fixes) all resolved and 71/71 tests green.

## High-value fixes (do before public launch)
1. **Add live opencode integration E2E** — exercise `experimental.chat.system.transform` + `tool.execute.before/after` inside a real `opencode` process with a fixture project. Proves hook registration via `types.gen.ts` pattern actually fires (currently mocked in hooks-index.test.ts:90-233). Estimated half-day with `src/hooks.ts:34-233` harness.
2. **Harden file locking** — `src/stores/instinctsStore.ts:90-91` and `src/stores/cacheStore.ts:39-44` use write-temp-then-rename but no `fcntl`/`flock`. Concurrent opencode sessions could clobber `~/.cache/better-opencode/instincts.json`. Port Hermes `utils/lock.ts` with `fs.open + flock` retry 50ms.
3. **Cap secret-scrub false positives** — `src/rag/injectionScanner.ts:1-12` broad `/secret/i` matches "SecretSanta" in skill body and scrubs. Scope to `secret\s*[=:]` or `process.env.*SECRET` to reduce noise while keeping `ghp_`, `sk-`, `AKIA` strict.
4. **Document rollback/runbook** — add 30-line README section: install (`opencode.json.example`), `teach`, `/self-improve status|rollback <slug>`, where T2/T3 live (`.agents/skills` + `~/.config/opencode/skills-library`), and cache invalidation (`rm -rf ~/.cache/better-opencode`).

## Strengths (short)
- Strict TS 5.6 (`tsconfig.json:7 strict true`) + zod validation on every persisted artifact (`types.ts:3-129`).
- Three-tier propagation implemented and tested: T1 `stores/instinctsStore.ts` + `cacheStore.ts` sha256 + T2 `skillStore.ts` mirror + T3 library history/rollback.
- Hybrid RAG with RRF k=60 + definition/file boosts (`hybridSearch.ts:30-99`) + token-budgeted `<retrieved>` (`contextInjector.ts:3-33`) and contentHash cache.
- Guardrail `Guardrails.maxPerSession=5` enforced in `hooks.ts:125-145` and `curator/guardrails.ts:1-51` + `validateSkill` tested.
- 86% line coverage passing thresholds (`vitest.config.ts:12-16`, actual 86.51% line, 73.59% branch).

## Evidence checked
- `package.json:1-47` scripts/build/typecheck/test, Node >=20
- `tsconfig.json:1-26` strict, NodeNext, noUncheckedIndexedAccess
- `vitest.config.ts:1-20` thresholds lines 80/funcs 80/branches 70 + `npm test` 71 passed, 18 files
- `src/types.ts:97-114` ConfigSchema (threshold maxSkills TTL vectorStore budgets)
- `src/config.ts:1-77` merged defaults→global→project→env + Instinct/Skill zod
- `src/stores/*` (instinctsStore bounded 2200/1375 FTS frozen snapshot, cacheStore L1 1000 + L2 json)
- `src/curator/*` (evolver score=1*reuse+1.5*success+0.8*tokenNorm+3*explicit, guardrails max5, promotionService T3 archive)
- `src/rag/*` (chunker regex extraction, injectionScanner secret+injection, vectorStore memory BM25+cosine, indexer batch 32, contextInjector budget 4000)
- `src/state/*` (ledger toolGraph+toolCounts, sessionState errorFix + ledger, token delta)
- `src/compute/router.ts:1-60` auto/local/api freemem logic
- `src/quiz/*` (repoScanner frameworks, interview template bank, driftDetector jaccard>0.3 fileDelta>0.2)
- `src/hooks.ts:1-233` system/message/toolBefore/toolAfter/idle/fileWatcher/event handlers
- `src/index.ts:1-135` createPlugin wiring, tools teach/self-improve hooks
- `dist/` build artifacts present after `npm run build`
- `.gitignore`, `opencode.json.example`, `.github/workflows/ci.yml` just added (were missing pre-audit)

## Evidence missing
- CI run status / badge (workflow exists `.github/workflows/ci.yml` but no remote, no green check to lift cap from 84 → 100).
- Real opencode runtime E2E (tests mock opencode hooks; no `opencode run --plugin` exercised against fixture repo).
- Load/concurrency soak (1005-entry cache test covers size but not parallel `CacheStore` writes with lock contention).
- Bundle size / install smoke test (`npm pack --dry-run` + `npm install` from pack in empty opencode project).

## Coding-standards compliance (quick pass per `coding-standards` skill)
- PASS immutability defaults (`...user` spread in `stores/instinctsStore.ts:90`, `state/sessionState.ts:94-100`), verb-noun function names (`detectLanguage`, `hashText`, `scanSkillText`, `selectForInjection`), async/await with `Promise.all` where parallel, zod instead of `any` (`types.ts:1-129` noImplicitAny).
- PASS early returns (`hooks.ts:39-50`, `stores/cacheStore.ts:24-37`), named constants (`maxTokens 400`, `overlapRatio 0.2`, `MAX_PER_SESSION 5`).
- PASS error handling: each store `try {read} catch` returns fallback, `config.ts:57-61` safeParse fallback to DEFAULTS, `hooks.ts:60-76` try/catch around RAG, `index.ts:57-64` try/catch indexer init.
- LOW: no lint gate enforced in CI excerpt? Added `npm run lint` step but `eslint` config not present at repo root (falls back to default). Recommend `eslint.config.js` with `typescript-eslint` strict.

## Risk lenses
- **Security/auth:** `hooks.ts:94-145` blocks `.env` reads, scrubs `ghp_/AKIA/sk-` via `injectionScanner.ts:51-57`, no prompt-injection via `teach.ts:19-22` `scanSkillText` block — good. Missing rate-limit not applicable (local plugin).
- **Data:** `stores/*.ts` atomic write via tmp+rename, but no `fs.fsync`; rollback via `skillStore.ts:148-167` history but no migration versioning — acceptable for v0.1.
- **Ops:** `getConfig:33-48` fail-fast with DEFAULTS + envOverrides, `getCacheDir` deterministic, `Logger` debug gated. No health HTTP endpoint — `self-improve health` covers logical health.
- **UX:** launch-critical paths `teach` + `self-improve status/rollback` covered unit-wise; no UI.

## Next action
Run `npm run build && npm test -- --coverage && npm pack --dry-run` then open PR with `plans/better-opencode-self-improving-plugin.md` Step 8 exit criteria (tests ≥80% + types clean + one smoke install). After PR green, execute one live E2E `opencode` smoke in a temp project to lift cap to 90+.

## Score rationale
- Base 90 for Green build/tests/coverage + security/timeouts addressed.
- -5 capped branch/uncaptured concurrency risk (lock missing, fileWatcher not back-pressured).
- -3 CI not yet green on GitHub (present but unexecuted) triggers the skill rule cap at 84.
- Final 82 = Launchable With Caveats (70-84 band), no P0 blocker, two caveats above documented.
