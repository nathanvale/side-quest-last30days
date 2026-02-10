# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@side-quest/last-30-days` - a CLI tool and library that researches any topic from the last 30 days across Reddit, X (Twitter), and web search. Results are engagement-ranked, deduplicated, and scored.

**Stack:** TypeScript, Bun, Biome, Bunup (build), Changesets

---

## Commands

```bash
# Development
bun dev                  # Watch mode (runs src/index.ts)
bun run build            # Build via bunup to dist/

# Quality
bun run check            # Biome lint + format (write mode)
bun typecheck            # TypeScript type checking (uses tsconfig.eslint.json)
bun run validate         # Full pipeline: lint + types + build + test

# Testing
bun test                 # Run all tests (recursive)
bun test tests/index.test.ts  # Run single test file
bun test --watch         # Watch mode

# CLI usage (after build)
last-30-days <topic> [--mock] [--emit=compact|json|md|context|path] [--sources=auto|reddit|x|both] [--quick|--deep] [--debug] [--include-web]
```

---

## Architecture

### Dual entry points (bunup.config.ts)

- `src/index.ts` - Library API. Re-exports all public functions/types from `src/lib/`. No side effects.
- `src/cli.ts` - CLI binary (`last-30-days`). Orchestrates the full pipeline: parse args, search, enrich, normalize, score, dedupe, render.

### Pipeline (cli.ts `main()`)

1. **Config** (`config.ts`) - Loads API keys from env or `~/.config/last-30-days/.env`. Determines available sources (reddit/x/both/web).
2. **Models** (`models.ts`) - Auto-selects best OpenAI/xAI model. OpenAI: picks highest-version mainline GPT-5.x via API. xAI: alias-based (latest = grok-4-1-fast). Results cached in `~/.cache/last-30-days/`.
3. **Search** (parallel) - `openai-reddit.ts` uses OpenAI Responses API with `web_search` tool filtered to reddit.com. `xai-x.ts` uses xAI Responses API with `x_search` tool. Both parse JSON from LLM output text.
4. **Enrich** (`reddit-enrich.ts`) - Fetches real engagement metrics from Reddit's JSON API (`reddit.com/.../.json`). Extracts top comments and insights.
5. **Normalize** (`normalize.ts`) - Converts raw API responses to typed schema (`RedditItem`, `XItem`, `WebSearchItem`). Filters by date range.
6. **Score** (`score.ts`) - Weighted scoring: relevance (45%) + recency (25%) + engagement (30%). WebSearch items get a source penalty and no engagement component.
7. **Dedupe** (`dedupe.ts`) - Jaccard similarity on character n-grams. URL-based and content-based deduplication.
8. **Render** (`render.ts`) - Multiple output formats: compact (default), JSON, markdown, context snippet. Writes to `~/.local/share/last-30-days/out/`.

### Key data types (schema.ts)

`Report` is the central data structure containing `RedditItem[]`, `XItem[]`, `WebSearchItem[]`, metadata, and errors. Each item has `score` (0-100), `subs` (component scores), `engagement`, and `date_confidence`.

### Supporting modules

- `http.ts` - Fetch wrapper with retries, timeouts, and debug logging (`LAST_30_DAYS_DEBUG=1`)
- `cache.ts` - File-based caching in `~/.cache/last-30-days/` (24h TTL for results, 7d for model selection)
- `dates.ts` - Date parsing, formatting, recency scoring
- `ui.ts` - Terminal progress display
- `websearch.ts` - Web search result parsing, date extraction from URLs/snippets, domain exclusion

### External API dependencies

- **OpenAI Responses API** (`OPENAI_API_KEY`) - Reddit discovery via web search tool
- **xAI Responses API** (`XAI_API_KEY`) - X/Twitter discovery via x_search tool
- **Reddit JSON API** (no key needed) - Thread enrichment with real engagement data

---

## Code Conventions

| Area | Convention |
|------|------------|
| Files | kebab-case (`my-util.ts`) |
| Functions | camelCase |
| Types | PascalCase |
| Exports | Named only (no defaults) |
| Formatting | Biome: tabs, single quotes, 80-char, semicolons as needed |

Test files go in `tests/` directory (not co-located with source).

---

## Git Workflow

**Branch pattern:** `type/description` (e.g., `feat/add-feature`, `fix/bug-fix`)

**Commit format:** Conventional Commits (enforced by commitlint + husky)

**Before pushing:** Always run `bun run validate`

**Pre-push hook** blocks direct pushes to main.

---

## CI/CD Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `pr-quality.yml` | PR | Lint, types, tests |
| `publish.yml` | Push to main | Version & publish via Changesets |
| `autogenerate-changeset.yml` | PR | Auto-generate changeset if missing |
| `commitlint.yml` | PR | Validate commit messages |
| `security.yml` | Schedule/PR | CodeQL + Trivy scans |

---

## Special Rules

### ALWAYS

1. Run `bun run validate` before pushing
2. Create changesets for user-facing changes (`bun version:gen`)
3. Use named exports (no defaults)

### NEVER

1. Push directly to main (pre-push hook blocks)
2. Skip validation before commits
3. Use destructive git commands (`reset --hard`, `push --force`)
4. Create nested `biome.json` files - single root config only
