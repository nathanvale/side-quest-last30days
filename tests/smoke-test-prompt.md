# Smoke Test: @side-quest/last-30-days

## Instructions

You are running a comprehensive smoke test of the `@side-quest/last-30-days` CLI and library. This test exercises every major feature and validates the tool works correctly.

**Run each phase sequentially**, recording **PASS** or **FAIL** for every check. At the end, print a summary table showing results for all 15 phases.

**Quick Mode**: Set `QUICK=true` and skip phases marked `[SLOW]` to run tests faster.

---

## Setup Phase

Verify we're in the correct repository and build the project.

**S.1** - Verify package.json name field equals `@side-quest/last-30-days`

```bash
bun run -s -e "const pkg = require('./package.json'); process.exit(pkg.name === '@side-quest/last-30-days' ? 0 : 1)"
```

**PASS**: Exit code 0

**S.2** - Install dependencies

```bash
bun install
```

**PASS**: Exit code 0, no fatal errors

**S.3** - Build the project

```bash
bun run build
```

**PASS**: Exit code 0, `dist/` directory created with `cli.js` and `index.js`

**S.4** - Verify CLI binary is executable

```bash
./dist/cli.js --help
```

**PASS**: Exit code 0, output contains "Usage:"

---

## Phase 1: Help & Version

Test help output and version information.

**P1.1** - CLI help via --help flag

```bash
./dist/cli.js --help
```

**PASS**: Exit code 0, output contains "Usage:", "Options:", "Examples:"

**P1.2** - CLI help via -h flag

```bash
./dist/cli.js -h
```

**PASS**: Exit code 0, output contains "Usage:"

**P1.3** - Package version matches package.json

```bash
bun run -s -e "console.log(require('./package.json').version)"
```

**PASS**: Output is a semver version (e.g., "0.1.1")

---

## Phase 2: Mock Mode - Emit Formats

Test all five output formats with mock data. Each should exit successfully with format-specific output.

**P2.1** - Emit compact (default)

```bash
./dist/cli.js "test topic" --mock --emit=compact
```

**PASS**: Exit 0, output contains "Research Results:", "Reddit Threads", "X Posts"

**P2.2** - Emit JSON

```bash
./dist/cli.js "test topic" --mock --emit=json
```

**PASS**: Exit 0, output is valid JSON with `topic`, `reddit`, `x` fields

**P2.3** - Emit markdown

```bash
./dist/cli.js "test topic" --mock --emit=md
```

**PASS**: Exit 0, output contains "# test topic", "## Reddit Threads", "## X Posts"

**P2.4** - Emit context snippet

```bash
./dist/cli.js "test topic" --mock --emit=context
```

**PASS**: Exit 0, output contains "# Context:", "## Key Sources"

**P2.5** - Emit path to context file

```bash
./dist/cli.js "test topic" --mock --emit=path
```

**PASS**: Exit 0, output is a valid file path ending with "last-30-days.context.md"

**P2.6** - Validate JSON schema structure

```bash
./dist/cli.js "test topic" --mock --emit=json > /tmp/smoke-test-report.json
```

Then parse the JSON and verify it contains:
- `topic` (string)
- `days` (number)
- `range` object with `from` and `to` fields
- `generated_at` (ISO timestamp)
- `mode` (string)
- `reddit` (array)
- `x` (array)
- `web` (array, may be empty)
- `best_practices` (array)
- `prompt_pack` (array)
- `context_snippet_md` (string)

**PASS**: All required fields present, correct types

---

## Phase 3: Mock Mode - Source Modes

Test source selection flags. Mock mode simulates having both API keys available.

**P3.1** - Sources: reddit only

```bash
./dist/cli.js "test topic" --mock --sources=reddit --emit=json > /tmp/smoke-reddit.json
```

Parse JSON and verify:
- `reddit` array has items
- `x` array is empty

**PASS**: Reddit items present, X items empty

**P3.2** - Sources: x only

```bash
./dist/cli.js "test topic" --mock --sources=x --emit=json > /tmp/smoke-x.json
```

Parse JSON and verify:
- `reddit` array is empty
- `x` array has items

**PASS**: Reddit items empty, X items present

**P3.3** - Sources: both

```bash
./dist/cli.js "test topic" --mock --sources=both --emit=json > /tmp/smoke-both.json
```

Parse JSON and verify:
- Both `reddit` and `x` arrays have items

**PASS**: Both Reddit and X items present

**P3.4** - Sources: auto (same as both in mock mode)

```bash
./dist/cli.js "test topic" --mock --sources=auto --emit=json > /tmp/smoke-auto.json
```

Parse JSON and verify:
- Both `reddit` and `x` arrays have items

**PASS**: Both Reddit and X items present

**P3.5** - Sources: web (WebSearch fallback mode)

```bash
./dist/cli.js "test topic" --mock --sources=web --emit=compact
```

**PASS**: Exit 0, output contains "WEB SEARCH MODE", "Want better results? Add API keys"

---

## Phase 4: Mock Mode - Depth Modes

Test quick, default, and deep research modes.

**P4.1** - Default depth (no flag)

```bash
./dist/cli.js "test topic" --mock --emit=json > /tmp/smoke-default-depth.json
```

**PASS**: Exit 0, valid JSON output

**P4.2** - Quick mode

```bash
./dist/cli.js "test topic" --mock --quick --emit=json > /tmp/smoke-quick.json
```

**PASS**: Exit 0, valid JSON output

**P4.3** - Deep mode

```bash
./dist/cli.js "test topic" --mock --deep --emit=json > /tmp/smoke-deep.json
```

**PASS**: Exit 0, valid JSON output

**P4.4** - Conflicting flags: --quick and --deep together

```bash
./dist/cli.js "test topic" --mock --quick --deep
```

**PASS**: Exit non-zero, stderr contains "Cannot use both --quick and --deep"

---

## Phase 5: Mock Mode - Days Parameter

Test the --days lookback window parameter.

**P5.1** - Days: 7

```bash
./dist/cli.js "test topic" --mock --days=7 --emit=json > /tmp/smoke-days7.json
```

Parse JSON and verify `days` field equals 7

**PASS**: Exit 0, `days: 7` in JSON

**P5.2** - Days: 30 (default)

```bash
./dist/cli.js "test topic" --mock --emit=json > /tmp/smoke-days30.json
```

Parse JSON and verify `days` field equals 30

**PASS**: Exit 0, `days: 30` in JSON

**P5.3** - Days: 365 (maximum)

```bash
./dist/cli.js "test topic" --mock --days=365 --emit=json > /tmp/smoke-days365.json
```

Parse JSON and verify `days` field equals 365

**PASS**: Exit 0, `days: 365` in JSON

**P5.4** - Days: space syntax (--days 14)

```bash
./dist/cli.js "test topic" --mock --days 14 --emit=json > /tmp/smoke-days14.json
```

Parse JSON and verify `days` field equals 14

**PASS**: Exit 0, `days: 14` in JSON

---

## Phase 6: Cache Controls

Test cache behavior flags.

**P6.1** - Refresh flag (bypass cache read)

```bash
./dist/cli.js "test topic" --mock --refresh --emit=compact
```

**PASS**: Exit 0, output does NOT contain "CACHED RESULTS"

**P6.2** - No-cache flag (disable cache entirely)

```bash
./dist/cli.js "test topic" --mock --no-cache --emit=compact
```

**PASS**: Exit 0, output does NOT contain "CACHED RESULTS"

**P6.3** - Default caching (allows cache reads/writes)

First run:

```bash
./dist/cli.js "cache test topic" --mock --emit=compact > /tmp/smoke-cache-first.txt
```

Second run (should use cache in mock mode if implemented):

```bash
./dist/cli.js "cache test topic" --mock --emit=compact > /tmp/smoke-cache-second.txt
```

**PASS**: Both runs exit 0, output is consistent

---

## Phase 7: Include Web Flag

Test --include-web flag for WebSearch integration instructions.

**P7.1** - Include web with compact output

```bash
./dist/cli.js "test topic" --mock --include-web --emit=compact
```

**PASS**: Exit 0, output contains "WEBSEARCH REQUIRED" or "Use your WebSearch tool"

**P7.2** - Include web with JSON output

```bash
./dist/cli.js "test topic" --mock --include-web --emit=json > /tmp/smoke-web.json
```

Parse JSON and verify `web_search_instructions` field exists with:
- `topic`
- `date_range` object
- `days`
- `instructions`

**PASS**: Exit 0, `web_search_instructions` field present in JSON

**P7.3** - Include web with sources=reddit

```bash
./dist/cli.js "test topic" --mock --include-web --sources=reddit --emit=json > /tmp/smoke-reddit-web.json
```

Parse JSON and verify `web_search_instructions` exists

**PASS**: Exit 0, web search instructions present

---

## Phase 8: Debug Mode

Test --debug flag for verbose logging.

**P8.1** - Debug flag enables verbose output

```bash
./dist/cli.js "test topic" --mock --debug --emit=compact 2>&1 | tee /tmp/smoke-debug.txt
```

**PASS**: Exit 0, combined output (stdout+stderr) is longer than non-debug run or environment variable `LAST_30_DAYS_DEBUG=1` is set (verify programmatically if needed)

---

## Phase 9: Flag Combinations

Test complex flag combinations to ensure they work together.

**P9.1** - Combination: quick + JSON + reddit only

```bash
./dist/cli.js "test topic" --mock --quick --emit=json --sources=reddit > /tmp/smoke-combo1.json
```

**PASS**: Exit 0, valid JSON, only Reddit items present

**P9.2** - Combination: deep + markdown + include-web + days=7

```bash
./dist/cli.js "test topic" --mock --deep --emit=md --include-web --days=7 > /tmp/smoke-combo2.md
```

**PASS**: Exit 0, markdown output contains "# test topic", days=7 reference

**P9.3** - Combination: x only + context + refresh

```bash
./dist/cli.js "test topic" --mock --sources=x --emit=context --refresh
```

**PASS**: Exit 0, context output present, no cache warning

---

## Phase 10: Error Cases

Test that invalid inputs produce appropriate error messages and non-zero exit codes.

**P10.1** - Missing topic (no args)

```bash
./dist/cli.js
```

**PASS**: Exit non-zero, stderr contains "Please provide a topic"

**P10.2** - Invalid --emit value

```bash
./dist/cli.js "test topic" --emit=invalid
```

**PASS**: Exit non-zero, stderr contains "Invalid --emit value"

**P10.3** - Invalid --sources value

```bash
./dist/cli.js "test topic" --sources=invalid
```

**PASS**: Exit non-zero, stderr contains "Invalid --sources value"

**P10.4** - Conflicting depth flags

```bash
./dist/cli.js "test topic" --quick --deep
```

**PASS**: Exit non-zero, stderr contains "Cannot use both --quick and --deep"

**P10.5** - Days: 0 (below range)

```bash
./dist/cli.js "test topic" --days=0
```

**PASS**: Exit non-zero, stderr contains "must be an integer between 1 and 365"

**P10.6** - Days: 366 (above range)

```bash
./dist/cli.js "test topic" --days=366
```

**PASS**: Exit non-zero, stderr contains "must be an integer between 1 and 365"

**P10.7** - Days: non-numeric value

```bash
./dist/cli.js "test topic" --days=abc
```

**PASS**: Exit non-zero, stderr contains "must be an integer between 1 and 365"

**P10.8** - Unknown flag

```bash
./dist/cli.js "test topic" --unknown-flag
```

**PASS**: Exit non-zero, stderr contains "Unknown flag: --unknown-flag"

---

## Phase 11: Output Files

Verify that output files are written to the correct location after a run.

**P11.1** - Run CLI and check output directory

```bash
./dist/cli.js "output test topic" --mock --emit=compact
```

Check that `~/.local/share/last-30-days/out/` directory exists and contains:
- `report.json`
- `report.md`
- `last-30-days.context.md`

**PASS**: Exit 0, all three files exist and are non-empty

**P11.2** - Verify path output matches expected location

```bash
./dist/cli.js "test topic" --mock --emit=path
```

Capture output and verify it matches `~/.local/share/last-30-days/out/last-30-days.context.md`

**PASS**: Exit 0, output path is correct

**P11.3** - Verify context file content

Read `~/.local/share/last-30-days/out/last-30-days.context.md` and verify it contains:
- `# Context:` heading
- `## Key Sources` section
- `## Summary` section

**PASS**: Context file has expected structure

---

## Phase 12: Library Imports

Test that all public exports are accessible when used as a library.

**P12.1** - Verify cache exports

```bash
bun eval "import { loadCache, saveCache, getCacheKey, SEARCH_CACHE_SCHEMA_VERSION } from './dist/index.js'; console.log('PASS')"
```

**PASS**: Output contains "PASS"

**P12.2** - Verify config exports

```bash
bun eval "import { getConfig, getAvailableSources, getMissingKeys } from './dist/index.js'; console.log('PASS')"
```

**PASS**: Output contains "PASS"

**P12.3** - Verify date exports

```bash
bun eval "import { getDateRange, parseDate, daysAgo } from './dist/index.js'; console.log('PASS')"
```

**PASS**: Output contains "PASS"

**P12.4** - Verify dedupe exports

```bash
bun eval "import { dedupeReddit, dedupeX, jaccardSimilarity } from './dist/index.js'; console.log('PASS')"
```

**PASS**: Output contains "PASS"

**P12.5** - Verify schema exports

```bash
bun eval "import { createReport } from './dist/index.js'; import type { Report, RedditItem, XItem } from './dist/index.js'; console.log('PASS')"
```

**PASS**: Output contains "PASS"

**P12.6** - Verify render exports

```bash
bun eval "import { renderCompact, renderFullReport, renderContextSnippet } from './dist/index.js'; console.log('PASS')"
```

**PASS**: Output contains "PASS"

**P12.7** - Verify scoring exports

```bash
bun eval "import { scoreRedditItems, scoreXItems, sortItems } from './dist/index.js'; console.log('PASS')"
```

**PASS**: Output contains "PASS"

---

## Phase 13: Quality Pipeline

Run all quality checks to ensure code passes linting, type checking, tests, and builds.

**P13.1** - Run test suite

```bash
bun test
```

**PASS**: Exit 0, all tests pass, no failures

**P13.2** - Type check

```bash
bun typecheck
```

**PASS**: Exit 0, no type errors

**P13.3** - Biome check (lint + format)

```bash
bun run check
```

**PASS**: Exit 0, no lint or format errors

**P13.4** - Build (already done in setup, but rerun to verify idempotence)

```bash
bun run build
```

**PASS**: Exit 0, dist/ regenerated successfully

**P13.5** - Full validation pipeline

```bash
bun run validate
```

**PASS**: Exit 0, all steps pass (lint, typecheck, build, test)

---

## Phase 14: JSON Schema Round-Trip [SLOW]

Test that Report JSON can be serialized and deserialized correctly.

**P14.1** - Generate JSON report

```bash
./dist/cli.js "schema test" --mock --emit=json > /tmp/smoke-schema-report.json
```

**PASS**: Exit 0, valid JSON

**P14.2** - Parse and validate report structure

```javascript
// Run via bun eval
const fs = require('fs');
const report = JSON.parse(fs.readFileSync('/tmp/smoke-schema-report.json', 'utf-8'));

// Verify required top-level fields
const requiredFields = ['topic', 'days', 'range', 'generated_at', 'mode', 'reddit', 'x', 'web'];
const hasAllFields = requiredFields.every(f => f in report);

// Verify reddit items have required fields
const redditValid = report.reddit.length > 0 && report.reddit.every(r =>
  'id' in r && 'title' in r && 'url' in r && 'subreddit' in r && 'score' in r
);

// Verify x items have required fields
const xValid = report.x.length > 0 && report.x.every(x =>
  'id' in x && 'text' in x && 'url' in x && 'author_handle' in x && 'score' in x
);

console.log(hasAllFields && redditValid && xValid ? 'PASS' : 'FAIL');
```

**PASS**: Output is "PASS"

**P14.3** - Verify score ranges (0-100)

```javascript
// Run via bun eval
const fs = require('fs');
const report = JSON.parse(fs.readFileSync('/tmp/smoke-schema-report.json', 'utf-8'));

const redditScoresValid = report.reddit.every(r => r.score >= 0 && r.score <= 100);
const xScoresValid = report.x.every(x => x.score >= 0 && x.score <= 100);

console.log(redditScoresValid && xScoresValid ? 'PASS' : 'FAIL');
```

**PASS**: Output is "PASS"

---

## Phase 15: Optional Live API Tests [SLOW]

Run real API calls to verify end-to-end functionality. Skip if API keys are not available.

**P15.1** - Check for API keys

```bash
if [ -n "$OPENAI_API_KEY" ] && [ -n "$XAI_API_KEY" ]; then
  echo "KEYS_AVAILABLE"
else
  echo "KEYS_MISSING - Skipping live API tests"
fi
```

**SKIP if KEYS_MISSING**, otherwise continue:

**P15.2** - Live search: Reddit only (quick mode for speed)

```bash
./dist/cli.js "Bun runtime" --sources=reddit --quick --days=7 --emit=json > /tmp/smoke-live-reddit.json
```

**PASS**: Exit 0, JSON contains `reddit` array with at least 1 item

**P15.3** - Live search: X only (quick mode)

```bash
./dist/cli.js "Bun runtime" --sources=x --quick --days=7 --emit=json > /tmp/smoke-live-x.json
```

**PASS**: Exit 0, JSON contains `x` array with at least 1 item

**P15.4** - Live search: Both sources (quick mode)

```bash
./dist/cli.js "Bun runtime" --sources=both --quick --days=7 --emit=compact
```

**PASS**: Exit 0, output contains sections for both Reddit and X

**P15.5** - Verify cache is used on second run

First run:

```bash
./dist/cli.js "cache live test" --quick --days=7 --emit=compact > /tmp/smoke-live-first.txt
```

Second run immediately after:

```bash
./dist/cli.js "cache live test" --quick --days=7 --emit=compact > /tmp/smoke-live-second.txt
```

**PASS**: Second run output contains "CACHED RESULTS"

**P15.6** - Verify --refresh bypasses cache

```bash
./dist/cli.js "cache live test" --quick --days=7 --refresh --emit=compact > /tmp/smoke-live-refresh.txt
```

**PASS**: Output does NOT contain "CACHED RESULTS"

---

## Summary

After completing all phases, print a summary table:

```
Phase | Total Checks | Passed | Failed | Skipped
------|--------------|--------|--------|--------
Setup | 4            | ?      | ?      | 0
P1    | 3            | ?      | ?      | 0
P2    | 6            | ?      | ?      | 0
P3    | 5            | ?      | ?      | 0
P4    | 4            | ?      | ?      | 0
P5    | 4            | ?      | ?      | 0
P6    | 3            | ?      | ?      | 0
P7    | 3            | ?      | ?      | 0
P8    | 1            | ?      | ?      | 0
P9    | 3            | ?      | ?      | 0
P10   | 8            | ?      | ?      | 0
P11   | 3            | ?      | ?      | 0
P12   | 7            | ?      | ?      | 0
P13   | 5            | ?      | ?      | 0
P14   | 3            | ?      | ?      | 0
P15   | 6            | ?      | ?      | ?
------|--------------|--------|--------|--------
TOTAL | 68           | ?      | ?      | ?
```

Replace `?` with actual counts.

---

## Notes

- **Mock mode** uses fixture files from `fixtures/` directory and never makes real API calls
- **Exit codes**: 0 = success, non-zero = error
- **JSON validation**: Use `bun eval` or `jq` for parsing and field checks
- **File checks**: Use `test -f` or `ls` to verify file existence
- **String checks**: Use `grep` or manual inspection for content verification
- All paths are relative to repository root unless otherwise specified
- For QUICK mode, skip phases marked `[SLOW]`: P14, P15

---

## Expected Results

A fully passing smoke test should show:
- **Setup**: 4/4 passed
- **Phases 1-13**: 100% pass rate
- **Phase 14**: 3/3 passed (or skipped in QUICK mode)
- **Phase 15**: 6/6 passed OR 6 skipped (if no API keys)

**Total**: At minimum 59/62 passed (excluding live API tests), or 65/68 if API keys available.
