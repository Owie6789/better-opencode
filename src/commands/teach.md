---
description: "Teach the agent a new instinct (weighted 3x). Usage: /teach <instruction>"
agent: build
---

You are handling the `/teach` slash command.

User wants to teach an instinct: **$ARGUMENTS**

Steps:
1. Call the `teach` tool with `text = $ARGUMENTS`. The tool is provided by the better-opencode plugin.
2. Confirm what was learned: echo the instinct text, its current score, and where it is stored (T1 `~/.cache/better-opencode/<repoHash>/instincts.json` partitioned by repoHash, promoted to T2 `.agents/skills/<slug>/SKILL.md` + `.claude/skills/<slug>/SKILL.md` mirror when confidence passes threshold, T3 `~/.config/opencode/skills-library` archive).
3. If no argument was given, ask the user: "what should I remember?" and wait for their reply before calling the tool.

Do not skip the tool call and do not invent a success message without calling `teach`.
