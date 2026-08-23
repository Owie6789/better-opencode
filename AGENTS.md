**Rules**

- Fix the root cause, not the symptom. If code is broken, remove it or refactor at the root. Do not add a patch on top.
- When asked to review changes or run a review, read REVIEW.md.
- Never merge a branch without explicit confirmation in exact wording: Yes Merge Branch X (Branch/PR Name ABC) into Branch Y (Branch/PR Name XYZ).
- Keep code DRY. If you copy and paste, stop and extract a reusable function or module.
- Keep solutions simple. Do not over engineer.
- Keep impact small. Do not break existing behavior when you change code.
- Pre push: before you push any branch, regardless of diff size, run these gates. Load REVIEW.md from the main branch. Load the CodeRabbit profile and rereview your changes with it. Identify critical, major, minor and nitpick issues and fix them. Repeat up to three times until the output is clean. Do all steps without prompting the user. Then validate locally: run lint, typecheck, tests, and build. Check what CI validates and run those checks locally. Do not change tests to hide defects. Fix the code instead.
- Write code that explains itself. Do not add comments except to explain non obvious behavior.
- Follow existing patterns for dialogs, state, and API calls.

**Writing style repo wide**

- Mandatory: before you write or edit any user facing prose, load the `unslop` skill from `pstack/skills/unslop` in https://github.com/cursor/plugins and apply its rules.
- In short: no em dashes, straight quotes only, sentence case headings, active voice with a named actor, plain words over jargon, no chatbot phrases or filler, and concrete facts (paths, numbers, mechanisms) over feel good abstractions.

**Repository structure**

- This is a single package Node project, not a monorepo. Root scripts: `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`.
- Source lives in `src/` with `stores/`, `rag/`, `curator/`, `state/`, `quiz/`, `compute/`, `commands/`. Types and schemas live in `src/types.ts`.
- Tests sit next to source as `*.test.ts` and run with `vitest run --coverage`. Coverage threshold is 80 percent lines.
- The plugin entry is `src/index.ts`. It exposes opencode hooks and tools `teach` and `self-improve`.
- Config lives in `opencode.json` under `plugins.selfImproving`. CLI commands for tuning are `/self-improve status`, `/self-improve history`, `/self-improve rollback`, `/teach`.
- Plans and audits live in `plans/`. Do not edit generated `dist/` by hand.

**Opencode plugin — self improving**

- Three tier storage: T1 `instincts.json` with TTL and scored decay, T2 ` .agents/skills` plus `.claude` mirror, T3 `~/.config/opencode/skills-library`. Promotion moves T1 to T2 when confidence passes the threshold, T3 is an archive layer.
- Guardrail is max 5 new skills per session and only `auto-generated: true` frontmatter may auto promote. History is versioned and rollback restores a version.
- Retrieval is hybrid. Tree sitter chunking at function and class boundaries, plus token fallback. Search merges vector cosine, BM25, and AST symbol match with RRF k 60, then boosts definition and file coherence, then optional cross encoder rerank. Results inject under a `<retrieved>` block capped to 4000 tokens.
- Compute adapts. Local ONNX runs by default. API fallback runs when keys exist. Failures fall back to local after backoff. Content hash is sha256 of text plus chunker version plus embedder model.
- Observability tracks tool graph, error to fix pairs, token delta, and tool call delta. Evolver scores by reuse, success rate, token and tool call improvement, and explicit teach weight. Drift detection compares repo fingerprints and triggers reinterview when deps or files shift.

**Important scripts**

- `npm run build` — compile TypeScript to `dist/`.
- `npm run typecheck` — type check without emit.
- `npm test` — run vitest with v8 coverage and enforce thresholds.
- `npm run lint` — lint `src` with eslint.
- `npx tsc -p tsconfig.json` — direct build check used by CI.
