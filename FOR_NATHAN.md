# last-30-days: The Story Behind the Code

*A CLI that turns "what's been happening with X?" into scored, deduplicated, engagement-ranked research -- in under two minutes.*

---

## The Problem We're Actually Solving

You're in a Claude Code session. You want to know what people have been saying about Bun 1.3 in the last month. You could:

1. Open Reddit, search, click through threads, mentally rank by upvotes, lose 20 minutes
2. Open X, search, scroll through noise, give up
3. Google it, get SEO-optimized garbage from 2023

Or you could type `last-30-days "Bun 1.3"` and get scored, deduplicated results from Reddit and X with real engagement metrics, ranked by what the community actually cares about -- all in a format Claude can synthesize immediately.

This tool exists because **searching is easy, but curating is hard**. The internet has the information. The problem is signal-to-noise ratio, and the answer is engagement data. A Reddit post with 500 upvotes and 200 comments is worth more than a Medium article with "10 Best Practices for..." in the title. This tool knows that.

---

## The Architecture: A News Wire Service

Think of `last-30-days` like a news wire service from the 1920s. Multiple reporters (search APIs) are dispatched to different beats (Reddit, X, Web). They file their stories (raw results). An editor (the scoring pipeline) ranks them by newsworthiness (engagement + recency + relevance). A copy desk (deduplication) kills duplicate stories. And the wire (render) sends the final dispatch in whatever format the subscriber needs.

```
                    topic
                      |
                      v
              +-- parseArgs --+
              |               |
              v               v
       searchReddit      searchX         (reporters -- parallel)
              |               |
              v               |
        enrichReddit          |          (fact-checking)
              |               |
              v               v
          normalize        normalize     (copy editing)
              |               |
              v               v
            score           score        (editorial ranking)
              |               |
              v               v
           dedupe          dedupe        (kill duplicates)
              |               |
              +-------+-------+
                      |
                      v
                   render                (wire dispatch)
                      |
                      v
              stdout + disk files
```

### Why This Separation Matters

Every step is a pure-ish function in its own module. The pipeline flows in one direction. There's no shared mutable state between the search and processing phases. This means:

- You can test each step in isolation (and the tests do)
- You can add a new source (Hacker News? Bluesky?) by adding a search function and plugging it into the parallel search phase
- The scoring algorithm doesn't know or care where data came from

The dual entry point design (`src/index.ts` for library, `src/cli.ts` for CLI) means this pipeline can be embedded in other tools. The library re-exports every public function with no side effects. The CLI orchestrates the pipeline and manages progress display.

---

## The Technical Stack (And Why Each Piece)

### Bun

The runtime. Bun is the primary target because this tool lives in the Claude Code ecosystem, which runs on Bun. The `bunup.config.ts` sets `target: 'bun'`, and the shebang is `#!/usr/bin/env bun`. There's a `node-compat.yml` CI workflow that verifies the built output also works on Node.js, because the library export should be consumable by anyone.

### TypeScript (Strict Mode)

Full strict mode with extras (`noUncheckedIndexedAccess`, `noImplicitOverride`). Every array access could be `undefined`. Every override is explicit. This matters because the codebase deals heavily with untyped API responses -- Reddit's JSON API returns deeply nested objects with no schema guarantees. Strict mode catches the "I assumed this field existed" bugs at compile time.

### Biome

Replaces both ESLint and Prettier in a single tool. Tabs, single quotes, 80 chars, semicolons as needed. One config file, one command, no plugin hell. The biome.json overrides give test files a wider 100-char line width -- because test assertions are naturally verbose.

### Bunup

The build tool that enables the dual entry point pattern. It takes `['./src/index.ts', './src/cli.ts']` and produces separate bundles with code splitting -- shared code between the library and CLI gets extracted into `chunk-*.js`. Declaration files are generated for the library entry only.

### Changesets

Versioning that doesn't require you to think about version numbers at commit time. Write a changeset ("added --days flag"), and the publish workflow figures out whether that's a patch, minor, or major bump. The `publish.yml` workflow uses a GitHub App token (not GITHUB_TOKEN) so that version PRs trigger the auto-merge workflow -- GitHub's anti-recursion protection would otherwise block this.

---

## Deep Dive: The Scoring Algorithm

This is the brain of the tool. A Reddit thread with 5,000 upvotes about your topic from yesterday should rank higher than a generic blog post from two weeks ago. The scoring system makes that happen.

### The Three Components

Every item gets three sub-scores on a 0-100 scale:

| Component | Weight (Reddit/X) | Weight (WebSearch) | Why |
|-----------|-------------------|--------------------|----|
| Relevance | 45% | 55% | How on-topic is this? (from the LLM) |
| Recency | 25% | 45% | How recent? (linear decay over the lookback window) |
| Engagement | 30% | 0% | How much did the community care? |

WebSearch items get no engagement component (there's no equivalent of upvotes for a blog post), so they're reweighted and hit with a -15 point source penalty. This is the key insight: **engagement data is the differentiator**, and sources without it rank lower.

### The Engagement Formula

For Reddit:
```
raw = 0.55 * log1p(score) + 0.40 * log1p(num_comments) + 0.05 * (upvote_ratio * 10)
```

For X:
```
raw = 0.55 * log1p(likes) + 0.25 * log1p(reposts) + 0.15 * log1p(replies) + 0.05 * log1p(quotes)
```

The `log1p` is doing heavy lifting here. Without it, a viral post with 50,000 upvotes would dominate everything. `log1p(50000)` is only about 10.8, while `log1p(500)` is about 6.2. This compression means a moderately popular post (500 upvotes) still scores respectably against a viral one. The engagement scores are then normalized to 0-100 within each batch, so they're relative to the current result set.

### The Penalty System

Raw scores get adjusted:
- **Unknown engagement** (-10): If enrichment failed, we penalize rather than assume
- **Low date confidence** (-10): If we couldn't verify the date, it ranks lower
- **Medium date confidence** (-5): Partially verified dates get a lighter penalty
- **WebSearch source** (-15): No engagement data means less trust
- **WebSearch no date** (-20): A web result with no date is almost certainly old
- **WebSearch verified date** (+10): Found a date in the URL? That's reliable

### Why This Approach Over Alternatives

The obvious alternative is a single LLM call that ranks everything. But LLMs hallucinate relevance scores. They can't tell you a post had 5,000 upvotes unless they search for it. The hybrid approach -- LLM discovers, real APIs verify -- gives you the breadth of AI search with the trustworthiness of actual engagement metrics.

---

## Deep Dive: The Date Detective

Dates are the hardest problem in this codebase. Reddit's search API doesn't reliably return dates. X posts have dates but the xAI API might not expose them clearly. Web results are worst -- a blog post's date might be in the URL, the snippet, the title, or nowhere.

The `websearch.ts` module implements a "Date Detective" with a hierarchy of trust:

1. **URL date** (high confidence): `/2026/01/24/` in the path is almost certainly the publish date
2. **Snippet date** (medium confidence): "January 24, 2026" in the text is probably right
3. **Title date** (medium confidence): Same patterns, but titles can be misleading
4. **No date found** (low confidence): Penalized in scoring

The URL parser handles three formats: `/YYYY/MM/DD/`, `/YYYY-MM-DD-`, and `/YYYYMMDD/`. The snippet parser handles "January 24, 2026", "24 January 2026", ISO dates, relative dates ("3 days ago", "yesterday", "last week"), and even "hours ago".

For Reddit, the enrichment step (`reddit-enrich.ts`) sidesteps this entirely by fetching the real `created_utc` timestamp from Reddit's JSON API. This is why enrichment happens -- not just for engagement metrics, but for reliable dates.

---

## Deep Dive: The Deduplication Engine

When you search Reddit and X for the same topic, you'll get overlapping discussions. The same news story might spawn threads in r/programming, r/typescript, and r/webdev. The dedup engine uses Jaccard similarity on character trigrams to find near-duplicates.

### Why Character N-Grams (Not Words)

Word-based similarity breaks on:
- Typos: "TypeScript" vs "Typscript"
- Abbreviations: "JavaScript" vs "JS"
- Non-English content
- URL fragments mixed into titles

Character trigrams ("typ", "ype", "pes", "esc", "scr", "cri", "rip", "ipt") are more resilient. "TypeScript" and "Typscript" share most of the same trigrams. The default threshold of 0.7 means two items need 70% trigram overlap to be considered duplicates.

### The Algorithm

```
1. Normalize text (lowercase, strip punctuation, collapse whitespace)
2. Generate character 3-grams for each item
3. Compare all pairs (O(n^2), fine for <100 items)
4. Items are pre-sorted by score, so in each duplicate pair, the lower-scored item is removed
```

WebSearch dedup is simpler -- just URL-based deduplication with trailing-slash normalization.

---

## Deep Dive: Model Auto-Selection

The tool doesn't hardcode which AI model to use. For OpenAI, it queries the `/v1/models` endpoint and picks the highest-version mainline GPT-5.x model. "Mainline" means it filters out mini, nano, chat, codex, pro, preview, and turbo variants. This is in `models.ts:isMainlineOpenaiModel()`.

The version parser (`parseVersion`) handles semantic versions: "gpt-5.2" becomes `[5, 2]`, sorted descending. If the selected model fails with a 400 error containing "verified" or "does not have access", it falls back through `['gpt-4o', 'gpt-4o-mini']`.

For xAI, it's simpler. The `x_search` tool requires grok-4 family, so it uses alias-based selection: `latest` maps to `grok-4-1-fast`. No API call needed.

Both selections are cached for 7 days in `~/.cache/last-30-days/`. Model selection is one of the few things that doesn't change often enough to re-query every run.

---

## Deep Dive: Progressive Enhancement

The tool works with zero API keys. Here's the degradation path:

| Keys Available | Mode | What Happens |
|---------------|------|-------------|
| Both | `both` | Full pipeline -- Reddit + X with engagement |
| OpenAI only | `reddit` | Reddit threads with enrichment, no X |
| xAI only | `x` | X posts, no Reddit |
| Neither | `web` | Prints WebSearch instructions for Claude to execute |

The `--include-web` flag adds general web search to any mode. With both keys + web, you get `all` mode. The `config.ts:validateSources()` function handles all the combinatorics -- there are 7 effective source modes (`all`, `both`, `reddit`, `reddit-web`, `x`, `x-web`, `web`).

The web-only mode is interesting: it doesn't actually search the web. It outputs structured instructions for Claude to use its built-in WebSearch tool. The results come back through Claude, not through this tool's pipeline. This is the only mode where the tool is a coordinator rather than an executor.

---

## The Enrichment Two-Step

The Reddit pipeline has a step that other sources don't: enrichment. After the OpenAI Responses API returns a list of threads, each thread is fetched directly from Reddit's JSON API (`reddit.com/r/.../comments/.../.json`).

Why the two-step? Because the OpenAI web search tool returns what the LLM can see on the page -- titles, maybe some snippets. It can't tell you the real upvote count, the number of comments, or the upvote ratio. The enrichment step fetches the actual submission data and top 10 comments (filtered for `[deleted]`/`[removed]`), extracting:

- Real engagement: `score`, `num_comments`, `upvote_ratio`
- True date: `created_utc` timestamp (high confidence)
- Comment insights: Top comments distilled into single-sentence takeaways

The insight extraction (`extractCommentInsights`) is clever about filtering noise. Comments shorter than 30 characters are skipped. One-word agreements ("this", "same", "agreed", "exactly") are filtered. Insights are truncated at sentence boundaries when possible, falling back to ellipsis truncation.

---

## The HTTP Layer

The `http.ts` module wraps `fetch` with retry logic and debug support. Key decisions:

- **3 retries with exponential backoff** (1s, 2s, 3s). But no retry for 4xx errors (except 429 rate limits) -- a bad request won't become good on retry.
- **30-second default timeout** with per-request overrides. Search calls use 90-180s depending on depth.
- **Custom User-Agent**: `last-30-days-skill/1.0 (Claude Code Skill)`. Reddit's API blocks generic User-Agents.
- **Debug mode** via `LAST_30_DAYS_DEBUG=1`. Logs every request URL, payload keys, response status, and error bodies to stderr. Invaluable when an API call fails silently.

---

## The Caching System

File-based caching in `~/.cache/last-30-days/` with two TTLs:

| Cache Type | TTL | Key |
|-----------|-----|-----|
| Search results | 24 hours | SHA256 of `topic + fromDate + toDate + sources` |
| Model selection | 7 days | Provider name (`openai`, `xai`) |

Cache keys are hashed to avoid filesystem issues with special characters in topics. The cache is silent on failure -- if the cache directory is unwritable, the tool just fetches fresh data. `loadCacheWithAge()` returns both the data and the cache age, which the render layer uses to show "cached (3.2h old)" in the output.

---

## The Output System

Every run writes to `~/.local/share/last-30-days/out/`:

| File | Purpose |
|------|---------|
| `report.json` | Full report as JSON (for programmatic consumption) |
| `report.md` | Full markdown report (human-readable) |
| `last-30-days.context.md` | Compact context snippet (for embedding in prompts) |
| `raw_openai.json` | Raw OpenAI API response (for debugging) |
| `raw_xai.json` | Raw xAI API response (for debugging) |
| `raw_reddit_threads_enriched.json` | Enriched Reddit data (for debugging) |

The `--emit` flag controls what goes to stdout:
- `compact` (default): Markdown summary optimized for Claude to synthesize
- `json`: Full report as JSON
- `md`: Full markdown report
- `context`: The context snippet
- `path`: Just prints the path to the context file

The compact format includes a "data freshness" assessment. If fewer than 5 items are confirmed from the target date range, it warns: "LIMITED RECENT DATA -- results may include older/evergreen content." This transparency prevents Claude from confidently presenting stale information as recent.

---

## The CLI Design

The argument parser is hand-rolled (no deps). It supports both `--key=value` and `--key value` syntax for `--days`. Flags like `--quick` and `--deep` are mutually exclusive (the CLI errors if you pass both). Topics can be multi-word without quotes: `last-30-days Claude Code skills` works because non-flag arguments are concatenated.

The progress display (`ui.ts`) uses ANSI color codes with TTY detection fallback. It shows animated spinners with random witty messages during search phases. The color scheme is deliberate: purple for the tool, yellow for Reddit, cyan for X, green for web, red for errors. Each phase is timed, and the completion message shows the total elapsed time.

---

## The Test Suite

All 40 tests live in a single file (`tests/index.test.ts`). They cover:

- **Pure functions**: Date parsing, n-gram generation, Jaccard similarity, URL date extraction, domain extraction
- **Schema**: Report creation, serialization round-trip, backward compatibility
- **Scoring**: Custom `maxDays` parameter propagation
- **Rendering**: Context snippets, full reports, compact output with `days` field
- **CLI integration**: End-to-end with `--mock` flag, `--days` validation

The `--mock` flag is the testing cornerstone. Mock data lives in `fixtures/` -- sample OpenAI responses, xAI responses, Reddit thread JSON, and model lists. This means CI runs are deterministic, fast, and don't need API keys.

Coverage is enforced at ~80% lines/branches/functions in CI. The `TF_BUILD=true` env var in CI triggers Bun's test runner to output in a CI-friendly format.

---

## Best Practices Embedded in This Codebase

### 1. Parallel Where You Can, Sequential Where You Must

Reddit and X searches run in parallel via `Promise.allSettled()`. But enrichment is sequential -- each Reddit thread is fetched one at a time to avoid rate limiting. The CLI shows a progress counter (`Enriching 3/15...`) so you know it's working.

### 2. Fail Gracefully, Report Honestly

Every search task catches errors and stores them. If Reddit fails but X succeeds, you still get X results -- plus an error message in the report. The `Promise.allSettled()` pattern (not `Promise.all()`) ensures one failure doesn't kill the other search.

### 3. Separate Discovery from Verification

The LLM discovers threads. Real APIs verify engagement. This two-step pattern produces results you can actually trust. An LLM might hallucinate that a post has "high engagement," but `reddit.com/.../.json` doesn't lie.

### 4. Make Debug Mode Easy

`LAST_30_DAYS_DEBUG=1` or `--debug` flag. Every HTTP request is logged with URL, payload keys, response status, and error bodies. When an API returns unexpected data, you can trace exactly what was sent and received.

### 5. Design for Zero-Config

No API keys? Web-only mode. One key? Use what you've got. Both keys? Full power. The tool never errors out because of missing configuration -- it degrades gracefully and tells you what you're missing.

---

## How the CI/CD Works

17 GitHub Actions workflows. That sounds like a lot, but each one does exactly one thing:

**Quality gate** (`pr-quality.yml`): Lint + typecheck + test with coverage + shell script linting. The `gate` job at the end explicitly checks for failures across all jobs -- if any job fails or is cancelled, the gate fails with a detailed status report.

**Publishing** (`publish.yml`): Four modes in one workflow. `auto` (push to main) runs the Changesets action. `version` creates a pre-release version bump PR. `publish` publishes a pre-release to npm. `snapshot` creates a canary release. Uses OIDC trusted publishing after the first npm publish -- no NPM_TOKEN needed long-term.

**Auto-merge** (`version-packages-auto-merge.yml`): When the Changesets action creates a "chore: version packages" PR, this workflow auto-merges it via GitHub's GraphQL API. Uses a GitHub App token so the merge triggers downstream workflows.

**Security** (`security.yml` + `codeql.yml` + `dependency-review.yml`): CodeQL for static analysis, Trivy for vulnerability scanning, dependency review for supply chain. Runs on schedule and on PRs.

---

## Dragons and Gotchas

### The Bun Linker Leak

Bun 1.3.x's hoisted linker sometimes leaks devDependency folders to the project root as `*@@@*` suffixed directories. The `publish.yml` workflow has a cleanup step that `find`s and removes these before the build. The `.gitignore` already catches them with `*@@@*/`.

### Reddit's JSON API Rate Limiting

Reddit doesn't require an API key for `.json` endpoints, but it does rate limit. The enrichment step processes threads sequentially (not in parallel) to stay under the limit. If enrichment fails for a thread, it silently continues with unenriched data -- the item just gets a lower engagement score.

### The OpenAI Response Format

The OpenAI Responses API returns a deeply nested structure where the actual text output is buried in `output[].content[].text`. The parser (`parseRedditResponse`) handles both the current format and an older `choices[].message.content` format for compatibility. The JSON extraction uses a regex to find the `{"items": [...]}` block, because the LLM might wrap the JSON in markdown code fences or extra text.

### WebSearch Is Not a Real Search

The `web` mode doesn't actually search the web. It prints structured instructions for Claude to use its built-in WebSearch tool. This is a design constraint -- the tool runs as a subprocess, but Claude's WebSearch runs in-process. The web results go through the same normalize/score/dedupe pipeline, but they arrive via a different path.

### Date Parsing Edge Cases

`extractDateFromSnippet` supports "3 days ago" by computing against today's date. This means the same snippet gives different results on different days. The tests use fixed dates to avoid flakiness, but if you're debugging a date issue in production, check what "today" was when the search ran.

---

## What's Next

The architecture enables several natural extensions:

- **Hacker News source**: Add `hn-search.ts` with Algolia API, plug into the parallel search phase
- **Bluesky source**: Similar to X -- AT Protocol has a search API
- **Caching at the enrichment level**: Right now, re-running the same query re-enriches all Reddit threads. Caching individual thread data would save 80% of the enrichment time on repeat queries
- **Streaming output**: The progress display already updates in real-time. Streaming results as they arrive (instead of waiting for all sources) would improve perceived performance
- **Cross-source deduplication**: Currently, Reddit and X are deduped separately. A cross-source dedup step could catch the same story discussed in both places

---

## Final Thoughts

This codebase embodies a principle: **AI is good at finding things, humans (and their upvotes) are good at evaluating things**. The scoring algorithm doesn't try to be smart about what's important -- it defers to the crowd's engagement signals. The date detection doesn't trust the LLM's date estimates -- it goes to the source. The deduplication doesn't ask the LLM to identify duplicates -- it uses math.

The result is a tool that combines the breadth of AI search with the trustworthiness of real-world signals. And at ~900 lines of library code across 16 modules, it does this without any runtime dependencies beyond a single shared `@side-quest/core` package.

Not bad for a side quest.

---

*-- Built for Claude Code sessions where "what's happening with X?" deserves a real answer.*
