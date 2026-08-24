---
description: "Self-improve status, history, rollback, tune, health. Usage: /self-improve <status|history|rollback|tune|health> [args]"
agent: build
---

You are handling `/self-improve` for the better-opencode plugin.

Available subcommands (call the `self-improve` tool):
- `status` — show instincts T1 count, vectorStore chunks, cache stats, ledger error rate, skills T2/T3 counts, last curate, frozen budgets (system 2200, rag 4000).
- `health` — same as status but JSON, includes `vectorStoreCount` for no-RAG diagnostics.
- `history <slug>` — show version history for a skill.
- `rollback <slug> [timestamp]` — rollback a skill to previous version.
- `tune` — re-run adaptive interview (5-7 questions), refresh `.agents/skills/interview-<safe>.json` partitioned per repoHash, recompute fingerprint (`~/.cache/better-opencode/<repoHash>/fingerprint.json`), and drift signal.

Isolation model:
- T1 instincts: `~/.cache/better-opencode/<repoHash>/instincts.json` + `~/.cache/better-opencode/<repoHash>/fingerprint.json` (repoHash = sha256(projectRoot) 12 chars, plus deps+fileList drift detection; interview file `.agents/skills/interview-<safe>.json` mirrors to `.claude/skills/interview-<safe>.json`)
- T2 skills: per `projectRoot` at `.agents/skills/<slug>/SKILL.md` with mirror `.claude/skills/<slug>/SKILL.md` and `history/` versioning
- T3 library: global `~/.config/opencode/skills-library/<slug>/SKILL.md` archive

Parse `$ARGUMENTS` as `<subcommand> [slug] [versionOrTimestamp]`. Default to `status` if empty. Execute the matching `self-improve` tool call and render the result.
