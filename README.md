# better-opencode

[![npm version](https://img.shields.io/npm/v/better-opencode?color=0a7)](https://www.npmjs.com/package/better-opencode)
[![CI](https://github.com/Owie6789/better-opencode/actions/workflows/ci.yml/badge.svg)](https://github.com/Owie6789/better-opencode/actions/workflows/ci.yml)
[![Publish](https://github.com/Owie6789/better-opencode/actions/workflows/publish.yml/badge.svg)](https://github.com/Owie6789/better-opencode/actions/workflows/publish.yml)
[![license MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-333)](package.json)
[![opencode plugin](https://img.shields.io/badge/opencode-plugin-6b4eff)](https://opencode.ai/docs/plugins)

Self-improving opencode plugin that learns while you work, keeps bounded instincts, and promotes the useful ones into real skills.

This plugin watches tool use, scores instincts by reuse and error to fix rate, and injects only what helps the current prompt. It never writes a skill without your repo context.

## Install in one line

```bash
# project install (recommended)
npx better-opencode

# global install
npx better-opencode --global

# manual plugin install if you manage opencode.json yourself
npm i better-opencode
```

What `npx better-opencode` does:
1. Copies slash commands from the package `src/commands/*.md` to `.opencode/commands/` (project) or `~/.config/opencode/commands/` (global with `--global`)
2. Ensures `opencode.json` contains `"plugin": ["better-opencode"]` (skips with `--no-config`)
3. On next opencode start, Bun installs the npm spec into `~/.cache/opencode/node_modules` and auto-discovers hooks from `dist/index.js` plus skills from `src/skills/*/SKILL.md` and agents from `src/agents/*.md`. Slash commands come from the copied files above.

Restart opencode after install.

### Configure

```jsonc
// opencode.json
{
  "plugin": ["better-opencode"],
  "plugins": {
    "selfImproving": {
      "enabled": true,
      "confidenceThreshold": 3,
      "maxSkillsPerSession": 5,
      "maxInstincts": 200,
      "ttlDays": 14,
      "vectorStore": "memory",      // memory | sqlite-vec
      "embeddingModel": "potion-code-16M",
      "ragTokenBudget": 4000,
      "systemBudget": 2200,
      "adaptiveCompute": "auto"     // auto | local | api
    }
  }
}
```

Defaults live in `opencode.json.example`. Build and check locally with:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

## How project isolation works

Every repo is isolated. The plugin hashes your `projectRoot` and scopes the right things to that hash.

```
T1 instincts + fingerprint (per repo, partitioned by repoHash)
  ~/.cache/better-opencode/<repoHash12>/instincts.json
  ~/.cache/better-opencode/<repoHash12>/fingerprint.json   // deps + file list, jaccard drift >0.3
  interview answers: .agents/skills/interview-<safe>.json  // safe = sanitized projectRoot 40 chars
    mirrored to .claude/skills/interview-<safe>.json

T2 skills (per projectRoot, live)
  <projectRoot>/.agents/skills/<slug>/SKILL.md
  <projectRoot>/.claude/skills/<slug>/SKILL.md            // mirror, same content, same history
  <projectRoot>/.agents/skills/<slug>/history/<ts>.md     // versioned writes for rollback

T3 library (global archive)
  ~/.config/opencode/skills-library/<slug>/SKILL.md

Cache and vector store
  ~/.cache/better-opencode/<repoHash12>/cache.json         // L1 1000 in memory, L2 persisted
  vectorStore upsert key = sha256(text + chunkerVersion + embedderModel)
```

Why this matters:
- Two repos with the same skill slug do not collide. T2 stays inside `projectRoot`.
- T1 is partitioned by `repoHash = sha256(projectRoot).slice(0,12)`. Opening repo A never reads repo B instincts.
- T3 is global only for recall. Promotion copies to T3 after T2 is written; it never overwrites T2.
- Interviews write `interview-<safe>.json` per repo and mirror it. Deleting one repo interview does not affect another.
- Fingerprint detects drift (deps diff >0.3 or file delta >0.2) and triggers re-interview via `/self-improve tune`.

You can verify isolation:

```bash
# A writes instincts
ls ~/.cache/better-opencode/<hashA>/instincts.json
ls ~/.cache/better-opencode/<hashB>/instincts.json
ls .agents/skills           # only this project
ls ~/.config/opencode/skills-library  # global
```

## Active skill suggestion plus prompt-aware hybrid injection

The plugin suggests skills actively and injects only what matches your current prompt.

### System transform (always on, no prompt needed)

`experimental.chat.system.transform` merges into `output.system[0]` for Qwen and vLLM compatibility (single system block). It injects:

- Frozen instincts snapshot capped at `systemBudget` 2200 chars, decayed by `score * exp(-ageDays / ttlDays)`, top scored first
- Skill catalog block (top 5 T2 skills by name and description) as `<available-skills>`. The model sees what project skills exist before the first turn.

No vector search runs here. This stays cheap and predictable.

### Messages transform (prompt-aware, topK 3)

`experimental.chat.messages.transform` runs after `system.transform` (opencode ordering since PR 19961). It extracts the last user text up to 4000 chars, then:

1. **Hybrid RAG topK 3**: dense vector cosine plus BM25 plus AST symbol match fused by RRF k 60, boosted for definition 0.3 and file coherence 0.2, gated cross encoder rerank on top 50 to 10 when `ENABLE_CROSS_ENCODER=1` and `onnxruntime-node` is present. Result is capped by `ragTokenBudget` 4000 in a `<retrieved>` block. Prompt is `"your actual question"` not `"project context"`.
2. **Skill catalog topK 3 matched to prompt**: scores each T2 skill by term overlap against the prompt (slug plus description plus tags plus body snippet 500 chars), filters to score >0, keeps 3. Injected as `<available-skills topK="3">`.

Injection uses in place splice:

```ts
output.messages.splice(insertAt, 0, { role: "system", content: merged })
```

The injection sits before the last user message so the model sees it as context for that turn only. Subagents are skipped (`session.isSubAgent`). Everything is scrubbed for secrets before inject (`src/rag/injectionScanner.ts`).

Token budgets: system 2200, retrieved 4000. Total injected per turn stays under about 6200 chars plus catalog 3 lines.

## Commands

Slash commands are copied by `bin/setup.js` to `.opencode/commands/` and call the same tools the plugin exposes.

### /teach

```md
/teach always validate input before processing
```

Calls `teach` tool with `explicitWeight 3`, TTL 30 days, confidence 8. That weight makes explicit guidance outrank synthesized instincts until decay wins.

### /self-improve

```
/self-improve status                 // budgets, counts, guardrail remaining, interviews
/self-improve health                 // same as JSON, includes vectorStoreCount for no-RAG checks
/self-improve history <slug>        // list versions for a skill
/self-improve rollback <slug> [ts]  // restore history/<ts>.md to both mirrors
/self-improve tune                  // rescan repo, rerun 5 to 7 question interview if drift
```

Tools behind the slash (call directly too):

```json
{ "tool": "teach", "args": { "text": "prefer early returns" } }
{ "tool": "self-improve", "args": { "subcommand": "status" } }
{ "tool": "self-improve", "args": { "subcommand": "history", "slug": "my-skill" } }
```

## Where things live

- T1 instincts: `~/.cache/better-opencode/<repoHash>/instincts.json` (max 200, GC evicts when ageDays > ttl and decayed <0.5)
- T1 cache: `~/.cache/better-opencode/<repoHash>/cache.json` plus `cache.sqlite` when sqlite is present. Key is `sha256(text + chunkerVersion + embedderModel)`. L1 1000, L2 persisted.
- T2 skills: `projectRoot/.agents/skills/<slug>/SKILL.md` and `projectRoot/.claude/skills/<slug>/SKILL.md` (mirrored). History at `history/<ts>.md`.
- T3 archive: `~/.config/opencode/skills-library/<slug>/SKILL.md`
- Interviews: `.agents/skills/interview-<safe>.json` mirrored to `.claude/skills/interview-<safe>.json` where safe is sanitized projectRoot 40 chars (`src/quiz/interview.ts:112`)
- Fingerprint: `~/.cache/better-opencode/<repoHash>/fingerprint.json`
- Config: `opencode.json` project, `~/.config/opencode/config.json` global, env overrides `BETTER_OPENCODE_*` win last

## Rollback and runbook

**Bad promotion:**

```json
{ "tool": "self-improve", "args": { "subcommand": "history", "slug": "bad-skill" } }
{ "tool": "self-improve", "args": { "subcommand": "rollback", "slug": "bad-skill", "version": "1714050000000" } }
```

Or manually:

```bash
rm -rf .agents/skills/bad-skill .claude/skills/bad-skill
rm -rf ~/.config/opencode/skills-library/bad-skill
npm test
```

Every promotion versions the previous file as `history/<ts>.md`. Rollback restores both mirrors from that file.

**Stale instincts:**

```bash
# inspect
npx better-opencode --help
# health shows counts
# via tool:
# self-improve status

# clear one repo only
rm ~/.cache/better-opencode/<repoHash>/instincts.json
# clear all
rm -rf ~/.cache/better-opencode
```

Next session rebuilds the index. The indexer skips unchanged files by content hash, so a clear is rarely needed unless the chunker or embedder version changed and you want to force reindex.

**Guardrail:**

Log says `Guardrail: max 5/5 skills per session`. The counter resets next session or after `session.compacted`. Candidates stay in T1 and retry next idle.

**Lock contention:**

Writes use atomic tmp plus fsync plus rename plus fsync directory with `withFileLock` using `O_EXCL` and retry every 50 ms, 5 s timeout, stale 10 s. No manual cleanup needed. If you see a stale lock older than 10 s the next write overwrites it.

## Publish pipeline

This repo publishes to npm with trusted OIDC provenance. No long lived token needed.

- Package includes `dist/`, `src/commands/*.md`, `src/skills/*/SKILL.md`, `src/agents/*.md`, `bin/setup.js` (`package.json:files`)
- `publishConfig.provenance: true` emits attestations
- Workflow `.github/workflows/publish.yml` triggers on `v*` tags, `release: published`, or manual dispatch. It runs on `ubuntu-latest` with `node 24` and `npm@latest`, typechecks, lints, tests, builds, then `npm publish --provenance --access public` with `id-token: write`.

First time setup on npmjs.com: Project Settings -> Trusted publishers -> Add GitHub Actions publisher for `Owie6789/better-opencode` workflow `publish.yml` and environment none. After that, push a tag:

```bash
npm version patch
git push origin main --tags
# GH Action publishes and provenance appears on the npm page
```

Fallback: if trusted publisher is not configured yet, add `NPM_TOKEN` as a repo secret and the same workflow will publish with it.

### Verify provenance

```bash
npm audit signatures
npm view better-opencode dist.attestations
```

## Architecture in one page

- `src/config.ts` merges defaults, global file, project file, env and validates with zod. Change defaults there.
- `src/stores/instinctsStore.ts` bounds snapshots to 2200 and 1375 chars, enforces cap 200, decay `score * exp(-ageDays / ttlDays)`, partitions by `repoHash`. Callers read `frozenSnapshot` at system transform.
- `src/stores/skillStore.ts` writes atomically to `.agents/skills` plus `.claude/skills` mirrors, keeps `history/<ts>.md`, gates promotion on `auto-generated: true`, archives to T3.
- `src/stores/fingerprint.ts` hashes deps plus glob `**/*.{ts,js,tsx,jsx,py,rs,go,java,json}` ignoring `node_modules/.git/dist/.agents/.claude/coverage/.cache`, stores per repo, computes jaccard drift.
- `src/rag/chunker.ts` tries `web-tree-sitter` WASM at function and class boundaries then regex then 400 token windows with 20 percent overlap. Version is tracked so hash key changes when chunker changes.
- `src/rag/embedder.ts` picks `LocalOnnx` for `potion-code-16M` when onnx is present and free memory above 500 MB, else hashed local embedder, fallback `Voyage` only with API key. `compute/router.ts` backs off 60 s after three failures.
- `src/rag/vectorStore.ts` uses `sqlite-vec` vec0 when `better-sqlite3` plus `sqlite-vec` are present and falls back to in memory BM25 plus cosine.
- `src/rag/hybridSearch.ts` fuses dense plus BM25 plus AST ids with RRF k 60, adds file coherence 0.2 and definition 0.3, gated cross encoder on top 50 to 3 when enabled.
- `src/rag/indexer.ts` globs excluding `node_modules/.git/dist/.agents/.claude/coverage/.cache`, checks content hash cache, batches embeddings 32, upserts dense and BM25.
- `src/hooks.ts` merges instincts plus catalog into `output.system[0]` (Qwen compat) and prompt-aware `<retrieved>` plus catalog topK 3 into `output.messages` via splice before the last user message. Subagents are skipped. `src/curator/evolver.ts` scores `reuse*1 + successRate*1.5 + tokenNorm*0.8 + explicit*3 + toolCalls*0.5` and synthesizes error to fix instincts.

## Troubleshooting

**No RAG results:** Run `self-improve health` and check `vectorStoreCount`. If 0, the indexer skipped files under 10 bytes or over 500 k truncated, or `projectRoot` at index did not match the one you query. Ensure `createPlugin({ projectRoot })` uses the right root. Files are excluded if under `node_modules/.git/dist/.agents/.claude/coverage/.cache`.

**No catalog suggestions:** `health` shows `skillsT2` count. If 0, no T2 skills exist yet. Promote one via idle curator (score needs reuse 3, successRate 0.6, threshold 3) or `/teach`.

**Secrets scrubbed too eagerly:** The scanner anchors on assignment context such as `api_key =`, `OPENAI_API_KEY=`, `Bearer `, `sk-proj-`, `ghp_`, `AKIA` with assignment or header context and replaces with `[REDACTED]`. Generic mentions of the word secret do not trigger. See `src/rag/injectionScanner.ts`.

**Build warnings about better-sqlite3:** They are intentional dynamic imports. Lint tolerates them. Any other warning fails `npm run lint`.

## Version and license

Version is `0.1.0` in `package.json`. Types are strict TypeScript 5.6 with NodeNext. Tests use vitest 2.1 with v8 coverage thresholds 80 percent lines and functions. License is MIT.
