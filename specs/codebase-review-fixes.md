# Plan: Codebase Review Critical Fixes

## Task Description
Implement fixes for 9 critical issues identified across a 3-pass staff engineer review (Architect, Skeptic, DX Advocate) of the @side-quest/last-30-days codebase. Issues span data integrity, CLI contract safety, runtime reliability, and testing fidelity.

## Objective
Fix all 9 critical issues so the codebase produces correct, predictable output across all CLI invocations -- no NaN scores, no JSON corruption, no silent arg misinterpretation, no crashes from file permissions.

## Problem Statement
The review uncovered real bugs that can silently corrupt output (NaN scoring), break downstream JSON consumers (`--emit=json` + `--include-web`), and crash the CLI in restricted environments (mandatory disk writes). The CLI also silently misinterprets user intent when flags use space-separated syntax (`--emit json` becomes part of the topic).

## Solution Approach
Fix in 4 phases matching risk priority: data integrity first, then CLI contract safety, then runtime reliability, then testing fidelity. Each phase has a builder and validator. Phases are sequential because later phases depend on earlier fixes being stable.

## Relevant Files

- `src/cli.ts` (866 lines) -- CLI orchestrator, arg parsing, pipeline. Affected by issues #2, #3, #4, #5, #8
- `src/lib/openai-reddit.ts` (271 lines) -- Reddit search parser. Affected by issue #1 (NaN relevance)
- `src/lib/xai-x.ts` (194 lines) -- X search parser. Affected by issue #1 (NaN relevance, engagement)
- `src/lib/score.ts` (210 lines) -- Scoring algorithm. Affected by issue #1 (NaN propagation)
- `src/lib/render.ts` (416 lines) -- Output rendering + file writes. Affected by issues #5, #7
- `src/lib/models.ts` (125 lines) -- Model auto-selection. Affected by issue #6
- `src/lib/config.ts` (144 lines) -- Source validation. Affected by issue #8
- `tests/index.test.ts` (882 lines) -- All tests. Every fix adds tests here
- `src/index.ts` (101 lines) -- Library exports. May need new exports for tests

### New Files
None. All changes are to existing files.

## Implementation Phases

### Phase 1: Data Integrity
Fix NaN scoring and JSON+web stdout corruption. These are the highest-risk bugs -- they produce silently wrong output.

### Phase 2: CLI Contract Safety
Fix arg parsing to reject unknown flags and support space-separated `--emit`/`--sources`. Validate enum values. These prevent silent user intent corruption.

### Phase 3: Runtime Reliability
Make disk writes non-fatal, fix model cache fallback for 404s, clean stale output artifacts. These prevent crashes and stale data.

### Phase 4: Testing Fidelity
Fix mock mode to use `validateSources()`, add web mode documentation. These ensure tests reflect real behavior.

## Team Orchestration

- You operate as the team lead and orchestrate the team to execute the plan.
- IMPORTANT: You NEVER operate directly on the codebase. Use Task and Task* tools only.
- Take note of the session id (agentId) of each team member for resume operations.

### Model Selection Guide

| Role | Model | Rationale |
|------|-------|-----------|
| All builders | sonnet | Executes well-specified tasks reliably |
| All validators | haiku | Mechanical checks: read files, run commands, report PASS/FAIL |

### Team Members

- Builder
  - Name: builder-data-integrity
  - Role: Fix NaN scoring and JSON+web corruption (Phase 1)
  - Agent Type: general-purpose
  - Model: sonnet
  - Resume: true

- Validator
  - Name: validator-data-integrity
  - Role: Verify Phase 1 fixes pass tests and type checks
  - Agent Type: general-purpose
  - Model: haiku
  - Resume: true

- Builder
  - Name: builder-cli-contract
  - Role: Fix arg parsing and enum validation (Phase 2)
  - Agent Type: general-purpose
  - Model: sonnet
  - Resume: true

- Validator
  - Name: validator-cli-contract
  - Role: Verify Phase 2 fixes pass tests and type checks
  - Agent Type: general-purpose
  - Model: haiku
  - Resume: true

- Builder
  - Name: builder-runtime
  - Role: Fix disk writes, model fallback, stale artifacts (Phase 3)
  - Agent Type: general-purpose
  - Model: sonnet
  - Resume: true

- Validator
  - Name: validator-runtime
  - Role: Verify Phase 3 fixes pass tests and type checks
  - Agent Type: general-purpose
  - Model: haiku
  - Resume: true

- Builder
  - Name: builder-testing
  - Role: Fix mock mode and add web mode docs (Phase 4)
  - Agent Type: general-purpose
  - Model: sonnet
  - Resume: true

- Validator
  - Name: validator-final
  - Role: Run full validation suite, verify all acceptance criteria
  - Agent Type: general-purpose
  - Model: haiku
  - Resume: true

## Step by Step Tasks

- Execute every step in order, top to bottom.
- Before starting, run TaskCreate for each task so all team members can see the full plan.

### 1. Fix NaN Scoring from Non-Numeric LLM Output
- **Task ID**: fix-nan-scoring
- **Depends On**: none
- **Assigned To**: builder-data-integrity
- **Agent Type**: general-purpose
- **Model**: sonnet
- **Parallel**: false
- **Context**: LLM output can contain non-numeric values like `"high"` for relevance or `"1k"` for engagement. `Number("high")` returns NaN, which propagates through scoring math to produce `item.score = NaN`.

**Changes to `src/lib/openai-reddit.ts`:**
- Line 259: The `relevance` field is parsed as `Number(item.relevance ?? 0.5)`. Add a `Number.isFinite()` guard:
  ```typescript
  const rawRel = Number(item.relevance ?? 0.5)
  relevance: Number.isFinite(rawRel) ? Math.min(1.0, Math.max(0.0, rawRel)) : 0.5,
  ```

**Changes to `src/lib/xai-x.ts`:**
- Line 182: Same pattern as openai-reddit.ts -- add `Number.isFinite()` guard for relevance:
  ```typescript
  const rawRel = Number(item.relevance ?? 0.5)
  relevance: Number.isFinite(rawRel) ? Math.min(1.0, Math.max(0.0, rawRel)) : 0.5,
  ```
- Lines 163-166: Engagement values use `Number(engRaw.likes)` etc. The truthiness check (`engRaw.likes ?`) already filters `0` to `null` which is a separate bug. Fix both:
  ```typescript
  engagement = {
    likes: engRaw.likes != null ? (Number.isFinite(Number(engRaw.likes)) ? Number(engRaw.likes) : null) : null,
    reposts: engRaw.reposts != null ? (Number.isFinite(Number(engRaw.reposts)) ? Number(engRaw.reposts) : null) : null,
    replies: engRaw.replies != null ? (Number.isFinite(Number(engRaw.replies)) ? Number(engRaw.replies) : null) : null,
    quotes: engRaw.quotes != null ? (Number.isFinite(Number(engRaw.quotes)) ? Number(engRaw.quotes) : null) : null,
  }
  ```
  Consider extracting a `safeParseNumber(val: unknown): number | null` helper to reduce repetition.

**Changes to `src/lib/score.ts`:**
- Lines 95, 128, 160: Add a final NaN guard on `item.relevance` before computing `relScore`:
  ```typescript
  const relScore = Number.isFinite(item.relevance) ? Math.floor(item.relevance * 100) : 50
  ```
  This is a belt-and-suspenders defense -- parsers should already sanitize, but scoring should never produce NaN.

**Tests to add in `tests/index.test.ts`:**
- Import `parseRedditResponse` from `../src/lib/openai-reddit` and `parseXResponse` from `../src/lib/xai-x`
- These are not currently exported from `src/index.ts` -- add them to `src/index.ts` exports
- Test: `parseRedditResponse` with `relevance: "high"` produces a number, not NaN
- Test: `parseXResponse` with `relevance: "high"` produces a number, not NaN
- Test: `parseXResponse` with engagement `likes: "1k"` produces `null`, not NaN
- Test: `parseXResponse` with engagement `likes: 0` produces `0`, not `null` (fixes the truthiness bug)
- Test: `scoreRedditItems` with `relevance: NaN` on input produces a valid score (not NaN)

### 2. Validate Phase 1 - Data Integrity
- **Task ID**: validate-data-integrity
- **Depends On**: fix-nan-scoring
- **Assigned To**: validator-data-integrity
- **Agent Type**: general-purpose
- **Model**: haiku
- **Parallel**: false
- Run `bun test` -- all tests pass (including new NaN tests)
- Run `bunx tsc --noEmit` -- no type errors
- Run `bunx biome ci .` -- no lint errors
- Verify `parseRedditResponse` and `parseXResponse` are exported from `src/index.ts`
- Verify `Number.isFinite` guards exist in `openai-reddit.ts`, `xai-x.ts`, and `score.ts`
- Verify engagement truthiness bug is fixed (likes: 0 should produce 0, not null)

### 3. Fix JSON+Web Stdout Corruption
- **Task ID**: fix-json-web-corruption
- **Depends On**: validate-data-integrity
- **Assigned To**: builder-cli-contract
- **Agent Type**: general-purpose
- **Model**: sonnet
- **Parallel**: false
- **Context**: When `--emit=json` is combined with `--include-web`, the CLI emits valid JSON on stdout (line 823) and then appends plain-text WebSearch instructions (lines 833-857). This breaks downstream JSON parsing.

**Changes to `src/cli.ts`:**
- Lines 832-858: Wrap the WebSearch instructions block in a check that excludes `json` emit mode:
  ```typescript
  if (webNeeded && args.emit !== 'json') {
    // existing WebSearch instructions output...
  }
  ```
- When `--emit=json` and `webNeeded` is true, add the WebSearch instructions as a field in the Report object BEFORE JSON serialization. Add a `web_search_instructions` field to the JSON output:
  ```typescript
  if (webNeeded && args.emit === 'json') {
    const dict = schema.reportToDict(report)
    dict.web_search_instructions = {
      topic: args.topic,
      date_range: { from: fromDate, to: toDate },
      instructions: 'Use WebSearch tool to find 8-15 relevant web pages. Exclude reddit.com, x.com, twitter.com.',
    }
    console.log(JSON.stringify(dict, null, 2))
  } else if (args.emit === 'json') {
    console.log(JSON.stringify(schema.reportToDict(report), null, 2))
  }
  ```
  This keeps the JSON parseable while preserving the web search intent.

**Tests to add in `tests/index.test.ts`:**
- Test: `--mock --emit=json --include-web` produces valid JSON (parse doesn't throw)
- Test: `--mock --emit=json --include-web` JSON output has `web_search_instructions` field
- Test: `--mock --emit=compact --include-web` still shows WebSearch instructions in stdout

### 4. Fix Arg Parsing: Space-Separated Flags and Unknown Flag Rejection
- **Task ID**: fix-arg-parsing
- **Depends On**: fix-json-web-corruption
- **Assigned To**: builder-cli-contract
- **Agent Type**: general-purpose
- **Model**: sonnet
- **Parallel**: false
- **Context**: `--emit json` (space instead of `=`) silently makes "json" part of the topic. Unknown flags like `--foo` are silently ignored. Invalid enum values like `--emit=foo` exit 0 with no stdout.

**Changes to `src/cli.ts` `parseArgs()` function (lines 104-152):**

1. Add space-separated support for `--emit` and `--sources` (matching `--days` pattern):
   ```typescript
   } else if (arg === '--emit') {
     const value = args[i + 1]
     if (value && !value.startsWith('-')) {
       emit = value
       i += 1
     }
   } else if (arg === '--sources') {
     const value = args[i + 1]
     if (value && !value.startsWith('-')) {
       sources = value
       i += 1
     }
   ```

2. Add unknown flag rejection at the end of the if/else chain:
   ```typescript
   } else if (arg.startsWith('--')) {
     process.stderr.write(`Error: Unknown flag: ${arg}\n`)
     process.stderr.write('Run last-30-days --help for usage.\n')
     process.exit(1)
   } else if (!arg.startsWith('-')) {
     topic = topic ? `${topic} ${arg}` : arg
   }
   ```

3. Add enum validation after parsing completes (before the return statement):
   ```typescript
   const validEmits = ['compact', 'json', 'md', 'context', 'path']
   if (!validEmits.includes(emit)) {
     process.stderr.write(`Error: Invalid --emit value: "${emit}". Valid: ${validEmits.join(', ')}\n`)
     process.exit(1)
   }

   const validSources = ['auto', 'reddit', 'x', 'both', 'web']
   if (!validSources.includes(sources)) {
     process.stderr.write(`Error: Invalid --sources value: "${sources}". Valid: ${validSources.join(', ')}\n`)
     process.exit(1)
   }
   ```

**Tests to add in `tests/index.test.ts`:**
- Test: `--emit json` (space) produces JSON output, exit 0
- Test: `--sources reddit` (space) works correctly
- Test: `--emit=invalid` exits 1 with error message containing "Invalid --emit"
- Test: `--sources=invalid` exits 1 with error message containing "Invalid --sources"
- Test: `--unknown-flag` exits 1 with error message containing "Unknown flag"

### 5. Validate Phase 2 - CLI Contract
- **Task ID**: validate-cli-contract
- **Depends On**: fix-arg-parsing
- **Assigned To**: validator-cli-contract
- **Agent Type**: general-purpose
- **Model**: haiku
- **Parallel**: false
- Run `bun test` -- all tests pass
- Run `bunx tsc --noEmit` -- no type errors
- Run `bunx biome ci .` -- no lint errors
- Manually verify in test output: `--emit json` (space) produces JSON, not compact with "topic json"
- Verify `--emit=foo` exits 1
- Verify `--sources=foo` exits 1
- Verify `--unknown-flag` exits 1

### 6. Make Disk Writes Non-Fatal
- **Task ID**: fix-disk-writes
- **Depends On**: validate-cli-contract
- **Assigned To**: builder-runtime
- **Agent Type**: general-purpose
- **Model**: sonnet
- **Parallel**: false
- **Context**: `cli.ts:810` calls `writeOutputs()` before stdout emit. If `~/.local/share/last-30-days/out/` is unwritable (EPERM), the entire run crashes with no stdout output.

**Changes to `src/cli.ts`:**
- Line 810: Wrap `writeOutputs()` in try/catch:
  ```typescript
  try {
    render.writeOutputs(report, rawOpenai, rawXai, rawRedditEnriched)
  } catch (e) {
    if (DEBUG || args.debug) {
      process.stderr.write(`Warning: Could not write output files: ${e}\n`)
    }
  }
  ```
  Import `DEBUG` from `./lib/http.js` if not already available, or check `args.debug` only.

**Changes to `src/lib/render.ts`:**
- Line 374-411: Clean stale raw files at the start of `writeOutputs()`. Before writing new files, remove any existing raw files that won't be rewritten this run:
  ```typescript
  export function writeOutputs(
    report: Report,
    rawOpenai?: Record<string, unknown> | null,
    rawXai?: Record<string, unknown> | null,
    rawRedditEnriched?: Record<string, unknown>[] | null,
  ): void {
    ensureOutputDir()

    // Clean stale raw files from previous runs
    const staleFiles = ['raw_openai.json', 'raw_xai.json', 'raw_reddit_threads_enriched.json']
    for (const file of staleFiles) {
      const path = join(OUTPUT_DIR, file)
      try { unlinkSync(path) } catch { /* ignore if not exists */ }
    }

    // Write report files (always)
    writeFileSync(...)
    // Write raw files (conditionally, as before)
    ...
  }
  ```
  Import `unlinkSync` from `node:fs`.

**Tests to add in `tests/index.test.ts`:**
- Test: CLI still produces stdout when output dir is unwritable (use `HOME=/dev/null` or a read-only temp dir)
- Test: Running with `--sources=x` after `--sources=both` does not leave stale `raw_openai.json`

### 7. Fix Model Cache Fallback for 404
- **Task ID**: fix-model-fallback
- **Depends On**: fix-disk-writes
- **Assigned To**: builder-runtime
- **Agent Type**: general-purpose
- **Model**: sonnet
- **Parallel**: false
- **Context**: `isModelAccessError()` only triggers on status 400. A retired model returning 404 won't trigger fallback -- it'll throw and kill the search entirely. The model cache TTL is 7 days, so this failure persists.

**Changes to `src/lib/openai-reddit.ts`:**
- Line 72: Extend `isModelAccessError()` to also match 404:
  ```typescript
  export function isModelAccessError(error: http.HTTPError): boolean {
    if (error.status_code === 404) return true
    if (error.status_code !== 400) return false
    if (!error.body) return false
    const bodyLower = error.body.toLowerCase()
    return [
      'verified',
      'organization must be',
      'does not have access',
      'not available',
      'not found',
      'not supported',
      'unsupported',
    ].some((phrase) => bodyLower.includes(phrase))
  }
  ```

**Changes to `src/lib/models.ts`:**
- After line 42: When search fails with a model access error, invalidate the model cache so the next run re-selects:
  Add a new export function:
  ```typescript
  /** Invalidate cached model for a provider. */
  export function invalidateCachedModel(provider: string): void {
    cache.clearCachedModel(provider)
  }
  ```

**Changes to `src/lib/cache.ts`:**
- Add a `clearCachedModel()` function:
  ```typescript
  /** Clear cached model for a provider. */
  export function clearCachedModel(provider: string): void {
    const cacheFile = join(CACHE_DIR, `model_${provider}.json`)
    try { unlinkSync(cacheFile) } catch { /* ignore */ }
  }
  ```

**Changes to `src/cli.ts`:**
- In the search task functions, when a model access error causes fallback, call `models.invalidateCachedModel('openai')` so the stale cache doesn't persist for 7 days.

**Tests to add in `tests/index.test.ts`:**
- Test: `isModelAccessError` returns true for 404 status
- Test: `isModelAccessError` returns true for 404 regardless of body content
- Update existing `isModelAccessError` tests if they assert false for 404

### 8. Validate Phase 3 - Runtime Reliability
- **Task ID**: validate-runtime
- **Depends On**: fix-model-fallback
- **Assigned To**: validator-runtime
- **Agent Type**: general-purpose
- **Model**: haiku
- **Parallel**: false
- Run `bun test` -- all tests pass
- Run `bunx tsc --noEmit` -- no type errors
- Run `bunx biome ci .` -- no lint errors
- Verify `writeOutputs()` cleans stale raw files (grep for `unlinkSync` in render.ts)
- Verify `writeOutputs()` is wrapped in try/catch in cli.ts
- Verify `isModelAccessError` handles 404
- Verify `clearCachedModel` exists in cache.ts

### 9. Fix Mock Mode Source Validation
- **Task ID**: fix-mock-validation
- **Depends On**: validate-runtime
- **Assigned To**: builder-testing
- **Agent Type**: general-purpose
- **Model**: sonnet
- **Parallel**: false
- **Context**: `cli.ts:524-525` bypasses `validateSources()` in mock mode, hardcoding `sources = 'both'` for `auto`. This means `--mock --include-web` doesn't produce `all` mode, and source validation logic is untested in mock.

**Changes to `src/cli.ts`:**
- Lines 522-541: Replace the mock/non-mock branching with unified validation:
  ```typescript
  // Determine sources
  let sources: string
  if (args.mock) {
    // In mock mode, simulate having both keys available
    const mockAvailable = 'both'
    const [effectiveSources, error] = config.validateSources(
      args.sources,
      mockAvailable,
      args.includeWeb,
    )
    sources = effectiveSources
    if (error && !error.includes('WebSearch fallback')) {
      process.stderr.write(`Error: ${error}\n`)
      process.exit(1)
    }
  } else {
    // existing non-mock logic unchanged
    ...
  }
  ```
  This runs the same `validateSources()` code path in mock mode, so `--sources=auto --include-web` correctly produces `all` instead of `both`.

**Tests to add in `tests/index.test.ts`:**
- Test: `--mock --include-web --emit=json` produces `mode: "all"` in JSON output (not `"both"`)
- Test: `--mock --sources=reddit --emit=json` produces `mode: "reddit-only"` in JSON output

### 10. Add Web Mode Documentation
- **Task ID**: document-web-mode
- **Depends On**: fix-mock-validation
- **Assigned To**: builder-testing
- **Agent Type**: general-purpose
- **Model**: sonnet
- **Parallel**: false
- **Context**: `websearch.ts` has 312 lines of parsing/scoring code but CLI never populates `report.web`. This is by design (web mode hands off to Claude), but it's confusing. Add clarifying comments.

**Changes to `src/lib/websearch.ts`:**
- Add a module-level JSDoc comment explaining the handoff pattern:
  ```typescript
  /**
   * WebSearch module for last-30-days skill.
   *
   * ARCHITECTURE NOTE: This module provides parsing and normalization for web
   * search results, but the CLI does NOT call these functions directly. Web
   * search results are obtained by Claude using its built-in WebSearch tool
   * and passed to this module for normalization by the library API consumer.
   *
   * The CLI's web mode (`--include-web` or `--sources=web`) outputs structured
   * instructions for Claude to perform the web search, rather than executing
   * it directly. This is because the CLI runs as a subprocess, while Claude's
   * WebSearch runs in-process.
   *
   * These functions ARE used by the library export (`src/index.ts`) for
   * programmatic consumers who want to normalize/score web results.
   */
  ```

**Changes to `src/cli.ts`:**
- Near line 833: Add a comment explaining the web mode handoff:
  ```typescript
  // Web mode handoff: print structured instructions for Claude's WebSearch tool.
  // Unlike Reddit/X, web search runs in Claude's process, not ours.
  // See src/lib/websearch.ts module comment for architecture rationale.
  ```

No tests needed for documentation-only changes.

### 11. Final Validation
- **Task ID**: validate-all
- **Depends On**: document-web-mode
- **Assigned To**: validator-final
- **Agent Type**: general-purpose
- **Model**: haiku
- **Parallel**: false
- Run `bun test` -- all tests pass (expect ~110+ tests, up from 94)
- Run `bunx tsc --noEmit` -- no type errors
- Run `bunx biome ci .` -- no lint errors
- Verify acceptance criteria:
  1. `parseRedditResponse` with `relevance: "high"` returns numeric value
  2. `parseXResponse` with `likes: 0` returns `0`, not `null`
  3. `scoreRedditItems` never produces NaN scores
  4. `--emit=json --include-web` produces valid JSON
  5. `--emit json` (space) works the same as `--emit=json`
  6. `--emit=foo` exits 1 with clear error
  7. `--unknown-flag` exits 1 with clear error
  8. CLI produces stdout even when output dir is unwritable
  9. `isModelAccessError` returns true for 404
  10. `--mock --include-web` produces `mode: "all"`
  11. Stale raw files are cleaned between runs
  12. `clearCachedModel` function exists in cache.ts
- Run `bun run validate` -- full pipeline passes

## Acceptance Criteria
1. No NaN scores possible from non-numeric LLM output (parsers + scoring have guards)
2. `--emit=json` always produces parseable JSON, even with `--include-web`
3. `--emit json` (space-separated) works identically to `--emit=json`
4. Unknown CLI flags (`--foo`) exit 1 with descriptive error
5. Invalid enum values (`--emit=foo`, `--sources=foo`) exit 1 with descriptive error
6. CLI produces stdout output even when `~/.local/share/` is unwritable
7. `isModelAccessError()` handles 404 status codes
8. Stale raw output files are cleaned at the start of each run
9. Mock mode runs `validateSources()` so `--include-web` works correctly
10. Web mode handoff pattern is documented in source comments
11. All existing tests continue to pass
12. 15+ new tests added covering the above fixes
13. `bun run validate` passes (lint + types + build + test)

## Validation Commands
- `bun test` -- run all tests
- `bunx tsc --noEmit` -- verify no type errors
- `bunx biome ci .` -- lint and format check
- `bun run validate` -- full pipeline: lint + types + build + test

## Notes
- **Branch**: Create `fix/codebase-review-critical-fixes` from main
- **Commit strategy**: One conventional commit per phase (4 commits total)
  - `fix(parsers): add NaN guards for non-numeric LLM output`
  - `fix(cli): add arg validation, space-separated flags, enum checks`
  - `fix(runtime): make disk writes non-fatal, fix model 404 fallback, clean stale artifacts`
  - `fix(testing): align mock mode with production source validation`
- **Downstream impact**: The `--emit=json` fix adds a `web_search_instructions` field to JSON output when web is included. The digest script should handle this gracefully (it only reads `reddit`, `x`, `web` arrays).
- **Engagement truthiness bug**: The Skeptic review revealed that `engRaw.likes ? Number(...)` treats `0` as falsy, converting `likes: 0` to `null`. This means posts with zero likes lose their engagement data. Fix this alongside NaN guards in Task 1.
- **No team member files found**: Using `general-purpose` agent type for all builders and validators since `.claude/agents/team/*.md` directory doesn't exist in this repo.
