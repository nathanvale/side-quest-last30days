1. **Verdict**  
**APPROVE WITH CONDITIONS**

2. **Strengths**
- Module split is mostly sensible for v0.1.x: date math, normalization, scoring, dedupe, cache, HTTP, and rendering are isolated and readable (`src/lib/dates.ts:7`, `src/lib/normalize.ts:38`, `src/lib/score.ts:82`, `src/lib/dedupe.ts:73`, `src/lib/cache.ts:70`, `src/lib/http.ts:218`, `src/lib/render.ts:44`).
- HTTP layer is strong: typed errors + retry/backoff + 429 retryability classification (`src/lib/http.ts:21`, `src/lib/http.ts:55`, `src/lib/http.ts:170`, `src/lib/http.ts:251`).
- Cache architecture is practical and production-minded for a CLI: versioned keys, stale fallback TTL, atomic write, lock file coordination (`src/lib/cache.ts:34`, `src/lib/cache.ts:92`, `src/lib/cache.ts:192`, `src/lib/cache.ts:199`, `src/lib/cache.ts:220`).
- Test and type discipline is good for early maturity: 94 tests passing, strict TS passes, and cache/429 behavior has direct tests (`tests/index.test.ts:503`, `tests/index.test.ts:303`).

3. **Critical Issues** (must fix before next major version)
- **Machine contract break for `--emit=json` in web-including modes.** JSON is emitted, then plain-text WebSearch instructions are appended to stdout, which breaks downstream JSON parsing (`src/cli.ts:823`, `src/cli.ts:833`).  
  This is high risk given your downstream `Bun.spawn(... --emit=json)` contract.
- **Web mode is architecturally inconsistent with the rest of the pipeline.** `websearch.ts` parsing/scoring exists, but CLI never executes it; it only prints instructions (`src/cli.ts:589`, `src/cli.ts:833`, `src/lib/websearch.ts:225`). `report.web` is never populated in CLI flow (`src/cli.ts:801`).  
  Either make web a real adapter or split this into a separate command/emit pathway.
- **Error contract inconsistency causes silent degradation.** Search adapters throw (`src/lib/openai-reddit.ts:164`, `src/lib/xai-x.ts:85`), but Reddit enrichment swallows errors and returns `null`/original item (`src/lib/reddit-enrich.ts:27`, `src/lib/reddit-enrich.ts:158`).  
  Failure semantics are hard to reason about and diagnostics are lost.

4. **Important Observations** (should address, not blocking)
- **`main()` decomposition:** 373 lines is tolerable for v0.1 CLI glue, but this one now mixes argument validation, source policy, model selection, parallel dispatch, enrichment, scoring, reporting, rendering, and side effects (`src/cli.ts:489`).  
  Refactor ROI is now good: extract phase functions + shared source-task runner, not a rewrite.
- **Source extensibility is currently hard-coded, not pluggable.** Adding Hacker News/Bluesky will require edits in config routing, mode strings, report schema, scoring, and render sections (`src/lib/config.ts:96`, `src/cli.ts:575`, `src/lib/schema.ts:89`, `src/lib/score.ts:82`, `src/lib/render.ts:114`).  
  This will become expensive within 6–12 months.
- **`best_practices` and `prompt_pack` should stay for now as reserved contract fields.** They are serialized/deserialized and rendered but never populated (`src/lib/schema.ts:92`, `src/lib/schema.ts:241`, `src/lib/render.ts:362`).  
  Recommendation: document as reserved + define population ownership; do not remove yet.
- **Cache versioning strategy is directionally right, but needs explicit bump policy.** Schema version + prompt version in key is intentional and safe (`src/lib/cache.ts:34`, `src/lib/cache.ts:111`, `src/lib/openai-reddit.ts:11`, `src/lib/xai-x.ts:8`).  
  Define when to bump prompt version (semantic retrieval changes only), otherwise you invalidate caches too often.
- **Sequential enrichment is safe but slow at deep depth.** Search is parallel, enrichment is strictly serial (`src/cli.ts:603`, `src/cli.ts:715`).  
  Bounded concurrency (e.g. 3–5) is a better long-term boundary.
- **CLI contract validation gaps:** invalid `--emit` can exit 0 with no stdout (`src/cli.ts:820`), and unknown `--sources` is accepted as mode text (`src/lib/config.ts:143`).  
  Tighten enum validation to protect downstream consumers.
- **Library surface is broad and semver-costly.** `index.ts` exposes many low-level internals (`src/index.ts:9`), but no stable high-level `runResearch()` API.  
  It’s not “export everything,” but it is close enough to freeze internals unintentionally.

5. **Nice-to-Haves**
- Add central unions/constants for `Mode`, `Source`, `Emit` to eliminate string drift across modules (`src/lib/schema.ts:86`, `src/lib/config.ts:96`, `src/lib/render.ts:123`).
- Split render formatting from file persistence (`src/lib/render.ts:44`, `src/lib/render.ts:375`) so write failures don’t kill otherwise valid stdout output.
- Break `tests/index.test.ts` into per-module files for maintainability and faster architectural signal (`tests/index.test.ts:1`).

6. **Questions for the Author**
- Should `--emit=json` be guaranteed parseable in every mode, including `--include-web` and `--sources=web`?
- Do you want web search to be a true first-class source in this package, or permanently an orchestration handoff to Claude tooling?
- Nathan, are `best_practices` and `prompt_pack` intended to be producer-owned by this tool, or consumer-filled placeholders?
- Is v1 expected to add new sources (HN/Bluesky)? If yes, should we introduce a source adapter interface before that expansion?